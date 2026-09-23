"""MySQL outbox -> confirmed RabbitMQ publish -> acknowledged per-worker fan-out.

At-least-once delivery is deliberate: notifications only invalidate/read current
state, never execute a stock mutation. Publisher crashes can safely replay them.
"""

import asyncio
import json
import os
import socket
from datetime import timedelta
from uuid import uuid4

import aio_pika
from sqlalchemy import delete, or_, select, update

from .config import settings
from .database import AsyncSessionLocal
from .inventory_events import InventoryChange, inventory_events, outbox_wakeups
from .models import NotificationOutbox, utcnow
from .observability import record

EXCHANGE = "heatsink.notifications"


def claim(db, owner):
    now = utcnow()
    with db.begin():
        rows = db.scalars(
            select(NotificationOutbox)
            .where(
                NotificationOutbox.published_at.is_(None),
                NotificationOutbox.available_at <= now,
                or_(NotificationOutbox.lease_until.is_(None), NotificationOutbox.lease_until < now),
            )
            .order_by(NotificationOutbox.created_at, NotificationOutbox.id)
            .limit(10)
            .with_for_update(skip_locked=True)
        ).all()
        result = []
        for row in rows:
            row.lease_owner, row.lease_until = owner, now + timedelta(seconds=120)
            row.attempts += 1
            result.append((row.id, row.payload, row.attempts))
        return result


def complete(db, message_id, owner, attempts, error=None):
    now = utcnow()
    with db.begin():
        values = {"lease_owner": None, "lease_until": None}
        if error is None:
            values.update(published_at=now, last_error=None)
        else:
            values.update(
                available_at=now + timedelta(seconds=min(30, 2 ** min(attempts, 5))),
                last_error=type(error).__name__[:80],
            )
        db.execute(
            update(NotificationOutbox)
            .where(
                NotificationOutbox.id == message_id,
                NotificationOutbox.lease_owner == owner,
                NotificationOutbox.published_at.is_(None),
            )
            .values(**values)
        )


def prune_published(db):
    """Bound retention without ever deleting pending or in-flight messages."""
    with db.begin():
        ids = list(
            db.scalars(
                select(NotificationOutbox.id)
                .where(NotificationOutbox.published_at < utcnow() - timedelta(days=7))
                .order_by(NotificationOutbox.published_at)
                .limit(500)
                .with_for_update(skip_locked=True)
            )
        )
        if ids:
            db.execute(delete(NotificationOutbox).where(NotificationOutbox.id.in_(ids)))
        return len(ids)


class RabbitTransport:
    def __init__(self):
        self.ready = False
        self.connection = None
        self.exchange = None
        self.queue_name = f"{EXCHANGE}.{socket.gethostname()}.{os.getpid()}"

    async def publish(self, message_id, payload):
        if not self.ready:
            raise ConnectionError("Notification queue is unavailable")
        await self.exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload, separators=(",", ":")).encode(),
                content_type="application/json",
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                message_id=message_id,
            ),
            routing_key="",
            mandatory=True,
            timeout=5,
        )

    async def run(self):
        while True:
            try:
                self.connection = await aio_pika.connect(
                    settings.message_queue_url, timeout=5, heartbeat=15
                )
                channel = await self.connection.channel(
                    publisher_confirms=True, on_return_raises=True
                )
                await channel.set_qos(prefetch_count=32)
                self.exchange = await channel.declare_exchange(
                    EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True
                )
                dead = await channel.declare_exchange(
                    EXCHANGE + ".dead", aio_pika.ExchangeType.FANOUT, durable=True
                )
                dead_queue = await channel.declare_queue(EXCHANGE + ".dead", durable=True)
                await dead_queue.bind(dead)
                queue = await channel.declare_queue(
                    self.queue_name,
                    durable=True,
                    arguments={
                        "x-expires": 86400000,
                        "x-dead-letter-exchange": EXCHANGE + ".dead",
                    },
                )
                await queue.bind(self.exchange)
                async with queue.iterator() as messages:
                    self.ready = True
                    # A fresh/reconnected worker must resync all of its views.
                    # This control notification also travels through RabbitMQ.
                    await self.publish(
                        uuid4().hex,
                        InventoryChange(team_ids=None, directory=True, accounts=True).envelope(),
                    )
                    async for message in messages:
                        try:
                            change = InventoryChange.from_envelope(json.loads(message.body))
                        except (ValueError, TypeError, UnicodeError):
                            await message.reject(requeue=False)
                            record("notification.rejected", reason="invalid_envelope")
                            continue
                        inventory_events.publish(change)
                        await message.ack()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Do not log broker URLs, credentials or session hashes.
                record("notification.queue_unavailable", error=exc)
            finally:
                self.ready = False
                if self.connection is not None:
                    try:
                        await self.connection.close()
                    except Exception as exc:
                        record("notification.close_failed", error=exc)
                    self.connection = None
            await asyncio.sleep(3)


class NotificationService:
    def __init__(self, transport=None):
        self.transport = transport or RabbitTransport()
        self.owner = uuid4().hex
        self.tasks = []
        self.next_prune = 0

    async def start(self):
        self.tasks = [
            asyncio.create_task(self.transport.run(), name="notification-consumer"),
            asyncio.create_task(self.send(), name="notification-outbox"),
        ]

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()

    async def send_batch(self):
        if not self.transport.ready:
            return False
        async with AsyncSessionLocal() as db:
            rows = await db.run_sync(lambda session: claim(session, self.owner))
        for message_id, payload, attempts in rows:
            error = None
            try:
                await self.transport.publish(message_id, payload)
            except Exception as exc:
                error = exc
            async with AsyncSessionLocal() as db:
                await db.run_sync(complete, message_id, self.owner, attempts, error)
        return bool(rows)

    async def send(self):
        with outbox_wakeups.subscribe() as wakeup:
            while True:
                wakeup.clear()
                try:
                    now = asyncio.get_running_loop().time()
                    if now >= self.next_prune:
                        async with AsyncSessionLocal() as db:
                            await db.run_sync(prune_published)
                        self.next_prune = now + 60
                    if await self.send_batch():
                        continue
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    record("notification.outbox_retry", error=exc)
                try:
                    await asyncio.wait_for(wakeup.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
