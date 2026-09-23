"""Compare snapshot computation/SQL amplification in a disposable local database.

Never connects to a supplied database or production URL. Timings are a local
SQLite microbenchmark, not HTTP QPS or a production user-capacity guarantee.
Example: python scripts/measure_inventory_fanout.py --clients 25 --populated
Use --backend with an older source snapshot to run the same workload before/after.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import math
import os
from pathlib import Path
import secrets
import sys
from tempfile import TemporaryDirectory
from threading import Barrier, Lock
from time import monotonic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, default=Path(__file__).resolve().parents[1] / 'backend')
    parser.add_argument('--clients', type=int, choices=(10, 25, 50, 100), default=25)
    parser.add_argument('--populated', action='store_true')
    args = parser.parse_args()
    if not (args.backend / 'app' / 'factory_stream.py').is_file():
        parser.error('--backend must contain app/factory_stream.py')
    with TemporaryDirectory(prefix='heatsink-fanout-') as temp:
        # Set before importing any application module; caller DB settings cannot leak in.
        os.environ.update(DATABASE_URL='sqlite:///' + str(Path(temp) / 'isolated.sqlite'),
                          AUTO_CREATE_TABLES='true', APP_ENV='test', SITE_ACCESS_PASSWORD='',
                          SEED_ADMIN_USERNAME='capacity_admin', SEED_ADMIN_PASSWORD=secrets.token_urlsafe(24))
        sys.path.insert(0, str(args.backend.resolve()))
        from fastapi.security import HTTPAuthorizationCredentials
        from sqlalchemy import event, func, select
        from app import factory_stream
        from app.auth import create_session, ensure_initial_admin
        from app.configure_material_teams import configure_material_teams
        from app.database import Base, SessionLocal, engine
        from app.models import MaterialTransfer, User
        from app.observability import logger
        from app.seed_team_material_showcase import seed_team_material_showcase

        logger.setLevel(logging.CRITICAL)
        try:
            Base.metadata.create_all(engine)
            with SessionLocal() as db:
                ensure_initial_admin(db)
                if args.populated:
                    seed_team_material_showcase(db, secrets.token_urlsafe(24))
                else:
                    configure_material_teams(db)
                user = db.scalar(select(User).where(User.username == 'capacity_admin'))
                token, _ = create_session(db, user)
                db.commit()
                record_count = db.scalar(select(func.count()).select_from(MaterialTransfer))
            credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=token)
            print(json.dumps({'kind': 'local SQLite fanout microbenchmark', 'material_records': record_count,
                              'clients': args.clients, 'backend': str(args.backend.resolve())}), flush=True)
            for view, name in (('inventory', 'factory_overview'), ('factory-live', 'live_endpoint')):
                counts, guard, start = {'builds': 0, 'sql': 0}, Lock(), Barrier(args.clients)
                original = getattr(factory_stream, name)

                def build(*positional, **kwargs):
                    with guard:
                        counts['builds'] += 1
                    return original(*positional, **kwargs)

                def query(*unused):
                    with guard:
                        counts['sql'] += 1

                def read():
                    start.wait(timeout=15)
                    before = monotonic()
                    value = factory_stream.read_inventory(credentials, view=view)
                    frame = value if isinstance(value, str) else factory_stream.message(view, value)
                    payload = json.loads(frame.split('data: ', 1)[1])
                    return (monotonic() - before) * 1000, payload['totals']

                setattr(factory_stream, name, build)
                event.listen(engine, 'before_cursor_execute', query)
                before = monotonic()
                try:
                    with ThreadPoolExecutor(max_workers=args.clients) as pool:
                        futures = [pool.submit(read) for _ in range(args.clients)]
                        values = [future.result(timeout=90) for future in futures]
                    assert all(value[1] == values[0][1] for value in values)
                    durations = sorted(value[0] for value in values)
                    print(json.dumps({'view': view, **counts, 'total_ms': round((monotonic() - before) * 1000, 1),
                                      'p50_ms': round(durations[math.ceil(len(values) * .5) - 1], 1),
                                      'p95_ms': round(durations[math.ceil(len(values) * .95) - 1], 1),
                                      'identical_totals': True, 'errors': 0}), flush=True)
                finally:
                    event.remove(engine, 'before_cursor_execute', query)
                    setattr(factory_stream, name, original)
        finally:
            engine.dispose()


if __name__ == '__main__':
    main()
