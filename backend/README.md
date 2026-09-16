# Heat Sink Production Flow API

FastAPI + SQLAlchemy 2 backend. The phase-one business flow is the independent
`/api/material-transfers` handoff ledger: a bound team leader enters a serial
number, whole-piece quantity, weight, and one receiving team; that team confirms
the whole batch. It has no work-order, product-route, report, or operation
dependency. Legacy production-flow endpoints and workflows have been removed;
historical tables and migration metadata remain intact in `app/legacy_models.py`.

The barcode payload is exactly the generated material-transfer batch number
(`TLYYYYMMDDNNNNNN`, Code 128). The existing concurrency-safe daily number
sequence is retained so historical barcode numbers are never reused.

`api.py` only assembles `auth_api.py`, `admin_api.py`, `material_transfer_api.py`
and `material_stock_api.py`. `models.py` contains current models;
`legacy_models.py` is schema metadata, not an old application. Team history
reference checks remain in `history_protection.py`. No legacy product,
work-order, reporting, production-summary or transfer-batch API is registered.

## Main-system serial materials (local implementation, not yet deployed)

The company system supplies serial/customer master data through the read-only
HTTPS contract in [the integration specification](../docs/main-system-integration.md).
`MAIN_SYSTEM_BASE_URL` and the backend-only `MAIN_SYSTEM_TOKEN` enable the adapter;
an empty URL returns an explicit 503, never demo data. Administrators can now save
an encrypted override in Settings → Main-system integration. This configuration
page requires migration `20260915_0012`, the `cryptography` dependency, a server-only
encryption key and an allowed-origin list. See [configuration instructions](../docs/main-system-configuration.md).

- `GET /api/main-system/serial-material?serial_no=...`: authenticated exact lookup;
  returns all document fields plus an opaque review hash, without creating stock.
- `POST /api/main-system/warehouses/{team_id}/receipts`: owning warehouse leader
  confirms physical quantities; server reloads the master record, checks the
  review hash, and saves the document snapshot and master revision in receipt audit.
  Retries are idempotent and do not depend on the upstream after a successful receipt.

The existing UI/manual intake is not switched automatically. Real integration,
UI selection, full-field batch printing and closing manual-data bypasses remain
required before production activation. No outbound company-system stock sync is implemented.

## Phase-one material-transfer API endpoints

- `POST /api/material-transfers`: TEAM account creates its own team's transfer.
- `GET /api/material-transfers`: authenticated list; exact `serial_no` returns
  the trace in chronological order. It also supports `query`, `source_team_id`,
  `next_team_id`/`target_team_id`, `status`, `page`, and `page_size`.
- `GET /api/material-transfers/{batch_no}`: barcode/detail lookup.
- `PATCH` or `DELETE /api/material-transfers/{batch_no}`: source team only,
  while status is `pending`.
- `POST /api/material-transfers/{batch_no}/confirm`: target team only; the body
  contains `idempotency_key` and optional `expected_version`. Confirmation receives the complete batch and
  permanently locks it.

## Team stock workspaces

`/api/team-materials/{team_id}` provides `GET /overview`, `GET /stock`, and
`GET/POST /dispatches` and `/losses`. A new receipt becomes a tracked source lot.
Outbound lines reference that lot, reserve available stock while pending, and
become dispatched when confirmed; voiding releases the reservation. Losses are
append-only, require a reason, and deduct only available quantities/weights.
Bulk dispatches contain 1–100 unique source lots and exactly one target team;
the CK number is the single Code 128 barcode for the whole batch. Source-linked
TL identities remain for traceability and old printed barcode compatibility;
new grouped screens use a single summary print and full-batch confirmation.

All mutations require a TEAM actor bound to the stock's receiving team. Source
row locks, MySQL current reads, transactional auditing and idempotency prevent
overspending and duplicate writes. Read endpoints aggregate by material and
page grouped dispatches on the server. Historical unlinked receipts are not
backfilled into stock. Manual initial transfer entry does not infer a source.

After upgrading to the current migration `20260907_0010`, `python -m app.configure_material_teams` adds
the eight configured teams and applies the approved 扎板→轧制 directory rename.
It does not delete legacy teams, create accounts, or rebind users. Production
deployment, opening-balance import, ERP integration, and external shipping
settlement are separate from this implementation.

### Warehouse manual receipts

`GET/POST /api/team-materials/{team_id}/receipts` supports manual warehouse
intake without any company-system integration. Only an active TEAM actor bound
to `FACTORY-WAREHOUSE` with kind `warehouse` may create one. Serial, material,
material type, quantity, weight, intake notes and an idempotency key are required;
other existing document fields are optional. At least quantity or weight must
be positive. Neither team IDs nor receipt state are supplied by the client.

The batch is immediately received, stock-tracked and locked. Its `entry_kind`
is `warehouse_receipt`, `source_team_id` and `source_team` are null, and its
destination is the warehouse. A `stocked` event, intake, and TL number are
committed atomically. Its stock supports existing dispatch/loss operations;
outbound children remain ordinary `transfer` records. Do not manufacture a
warehouse-to-itself handoff or re-enter internal receipts as manual intakes.

Migration 0008 retains existing records as `transfer`, makes source columns
nullable with a record-kind consistency constraint, and adds a warehouse/date
index. Existing migration files remain unchanged. SQLite custom migration
runners must disable foreign-key enforcement before a table-rebuild transaction
and run `foreign_key_check` afterward; the migration refuses an unsafe rebuild.
Bulk opening-stock import, correction/reversal tools and ERP integration remain
outside this change.

### Source-confirmed external outbound

`POST /api/team-materials/{team_id}/dispatches` accepts `entry_kind` (default
`transfer`), with `warehouse_outbound` limited to FACTORY-WAREHOUSE and
`inspection_shipment` to FACTORY-QC. External modes require a nonblank
`external_destination` (240 characters maximum) and no `next_team_id`.
They reserve stock from 1–100 distinct received source lots. The whole CK batch is
confirmed by its source team through `/api/material-dispatches/{dispatch_no}/confirm-outbound`
using an idempotency key and required review revision. Legacy TL confirmation
endpoints remain compatible. This produces
`dispatched`, not `received`, records the confirmer/time/audit, and permanently
locks the line. No destination stock or pending receipt is created. Pending
lines may be edited within existing source/group restrictions or voided.
The CK group supports `partial` and `dispatched`; list queries accept
`entry_kind` and external destination text. Internal transfers still require
a distinct real destination and receiver confirmation.

Migration 0009 makes destination columns nullable with explicit kind constraints,
adds external destination and confirmation metadata plus unique confirmation keys,
and indexes source team/kind/date on transfers and dispatches. Prior rows and
migrations remain intact. Finalization and idempotent audit replay use MySQL
current reads. This records physical outbound, not ERP, customer proof of delivery,
or financial settlement.

### One barcode and atomic batch confirmation

`GET /api/material-dispatches/{dispatch_no}` retrieves every line and its audit,
the shared Code 128 payload, totals, source/destination, pending-line count,
allowed actions and a 64-character `revision`. Internal receiver accounts use
`POST .../confirm`; authorized warehouse/QC source accounts use
`POST .../confirm-outbound`. The required body is
`{idempotency_key, expected_revision}`. Administrators remain read-only.

All sources are locked in sorted ID order, then current-read line rows and the
batch header. A changed line version/status rejects the reviewed batch with 409.
Every pending line and its audit commits in one transaction; pre-existing
completed/voided history stays intact. Identical key/original-revision replays
return the completed batch, not a second receipt. Keys cannot be reused for
different groups. Creation retries refresh both current lines and header.

Migration 0010 adds nullable confirmation metadata, a unique confirmation key
and a user foreign key to the existing dispatch table. No historical barcode,
source linkage, line status or audit is rewritten. CK lookup and dispatch-line
queries reuse existing unique/foreign-key indexes. Print is one A4 summary
copy with one CK barcode, with complete continuation pages for oversized batches.

Administrators can read transfer records but cannot create, edit, void, or
confirm them. New accounts created through the administration API are TEAM
leader accounts and must be bound to an active team.

An optional idempotent showcase uses only existing active TEAM accounts; it
never creates credentials. If there are not enough eligible team leaders, it
reports the skipped step:

```bash
python -m app.seed_material_transfer_showcase
```

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL='sqlite:///./heatsink.db'
uvicorn app.main:app --reload
```

OpenAPI is available at `/docs`. For local-only work, tables can be initialized
on application startup when `AUTO_CREATE_TABLES=true`. Production uses Alembic:

```bash
alembic -c alembic.ini upgrade head
```

For production, set a MySQL URL such as:

```text
mysql+pymysql://heatsink:password@mysql:3306/heatsink?charset=utf8mb4
```

## Tests

```bash
pytest
```

Targeted stock and transfer regression:

```bash
pytest tests/test_material_stock.py tests/test_material_transfers.py -q
```

`scripts/verify_mysql_material_stock.py --confirm-disposable` (from the project
root, `PYTHONPATH=backend`) requires an EMPTY disposable MySQL database named
exactly `heatsink_stock_qa`; never supply business database credentials. It
validates migrations including interrupted DDL recovery, grouped queries,
whole-submission rollback and concurrent reservations/losses/idempotent replay.
