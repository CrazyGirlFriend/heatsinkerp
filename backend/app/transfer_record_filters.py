"""Header filters for the team receiving and dispatch ledgers."""

from sqlalchemy import and_, case, func, literal, or_, select

from .configure_material_teams import MATERIAL_TEAMS
from .models import MaterialTransfer as Transfer
from .models import SharedMaterialMember as Member
from .table_query import column_predicate, current_table_query, table_options, table_predicates
from .team_constants import EXTERNAL_ENTRY_KINDS, outbound_kinds


def destination():
    team = case(
        {code: name for code, name, _, _ in MATERIAL_TEAMS},
        value=Transfer.next_team_code,
        else_=Transfer.next_team_name,
    )
    return case(
        (
            Transfer.entry_kind.in_(EXTERNAL_ENTRY_KINDS),
            func.coalesce(func.nullif(Transfer.external_destination, ""), "未填写外部去向"),
        ),
        else_=team,
    ).label("record_destination")


def receipt_columns():
    kind = Transfer.entry_kind
    origin = Transfer.__table__.alias("receipt_origin")
    original_serial = (
        select(origin.c.serial_no)
        .where(origin.c.id == Transfer.source_transfer_id)
        .scalar_subquery()
    )
    return {
        "record_source": case(
            (
                kind == "serial_reallocation",
                func.coalesce(func.nullif(original_serial, ""), "原流水号") + literal(" 转投入"),
            ),
            (kind == "opening_stock", "初始库存"),
            (kind == "rework_split", "返工料划分"),
            (
                kind == "warehouse_receipt",
                func.coalesce(func.nullif(Transfer.external_source, ""), "外部来源未登记"),
            ),
            else_=Transfer.source_team_name,
        ),
        "record_source_kind": case(
            (kind == "serial_reallocation", "转投入库"),
            (kind == "opening_stock", "初始库存"),
            (kind == "rework_split", "返工料划分"),
            (kind != "warehouse_receipt", "车间转入"),
            (Transfer.receipt_kind == "return", "外部退回"),
            else_="外部入库",
        ),
        "record_receiver": case(
            (
                kind == "transfer",
                func.coalesce(func.nullif(Transfer.received_employee_name, ""), "未登记"),
            ),
            else_=Transfer.received_by,
        ),
        "record_status": case(
            {
                "warehouse_receipt": "已入库",
                "opening_stock": "已登记",
                "serial_reallocation": "已转投",
                "rework_split": "待返工处理",
            },
            value=kind,
            else_="已接收",
        ),
        "record_location": func.coalesce(func.nullif(Transfer.warehouse_location, ""), "未填写"),
    }


def outbound_status():
    external = Transfer.entry_kind.in_(EXTERNAL_ENTRY_KINDS)
    action = case((Transfer.entry_kind == "inspection_shipment", "发货"), else_="出库")
    return case(
        (Transfer.status == "voided", "已作废"),
        (Transfer.status == "dispatched", literal("已") + action),
        (Transfer.status == "received", "已签收"),
        (external, literal("待") + action),
        else_="转出待签收",
    )


def serial_condition(item):
    direct = column_predicate(Transfer.serial_no, item)
    if direct is None:
        return None
    # Exclude a shared lot only when one of its actual members matches the excluded value.
    inverse = {"not_in": "in", "ne": "eq", "not_contains": "contains"}
    positive = (
        item.model_copy(update={"operator": inverse[item.operator]})
        if item.operator in inverse
        else item
    )
    member_match = (
        select(Member.id)
        .where(
            Member.group_id == Transfer.shared_group_id,
            column_predicate(Member.serial_no, positive),
        )
        .exists()
    )
    return or_(
        and_(Transfer.shared_unallocated.is_(False), direct),
        and_(
            Transfer.shared_unallocated.is_(True),
            ~member_match if item.operator in inverse else member_match,
        ),
    )


def apply_record_headers(db, columns, filters, kind, *, source_team=None, base=None):
    query = current_table_query.get()
    if not query:
        return
    columns["record_material_type"] = case(
        {
            "raw_material": "原材料",
            "finished": "成品",
            "semi_finished": "半成品",
            "finished_surplus": "成品余料",
            "semi_finished_surplus": "半成品余料",
            "defective": "废品",
            "waste": "废料",
            "sludge": "废泥",
            "scrap_chips": "废屑",
        },
        value=Transfer.material_type,
        else_="未填写",
    )
    if kind == "receipts":
        columns.update(receipt_columns())
    else:
        columns["record_sender"] = func.coalesce(
            func.nullif(Transfer.sent_employee_name, ""), "未登记"
        )
    if kind == "outgoing":
        columns.update(
            record_destination=destination(),
            record_status=outbound_status(),
            record_entry_kind=case(
                {"warehouse_outbound": "对外出库", "inspection_shipment": "检验发货"},
                value=Transfer.entry_kind,
                else_="内部转料",
            ),
        )
    filters.extend(table_predicates(columns, matches={"serial_no": serial_condition}))
    statement = (select(Transfer) if base is None else base).where(*filters)
    if kind == "outgoing" and query.options and query.options.field == "record_entry_kind":
        statement = statement.where(Transfer.entry_kind.in_(outbound_kinds(source_team)))
    if query.options and query.options.field == "serial_no":
        # Expand members only for the distinct-value picker. List counts and pagination stay per lot.
        statement = statement.outerjoin(
            Member,
            and_(
                Transfer.shared_unallocated.is_(True), Member.group_id == Transfer.shared_group_id
            ),
        )
        columns["serial_no"] = case(
            (Transfer.shared_unallocated, Member.serial_no), else_=Transfer.serial_no
        )
    elif query.sort and query.sort.field == "serial_no":
        first_member = (
            select(Member.serial_no)
            .where(Member.group_id == Transfer.shared_group_id)
            .order_by(Member.id)
            .limit(1)
            .scalar_subquery()
        )
        columns["serial_no"] = case(
            (Transfer.shared_unallocated, first_member), else_=Transfer.serial_no
        )
    table_options(db, statement, columns)
