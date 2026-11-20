"""Stable directory identity; no warehouse process-route concepts."""

WAREHOUSE_TEAM_CODE = "FACTORY-WAREHOUSE"
WAREHOUSE_TEAM_NAME = "库房"
ENGINEERING_TEAM_CODE = "FACTORY-PROCESS"
ENGINEERING_TEAM_NAME = "工艺"
DISPATCH_TEAM_CODE = "FACTORY-DISPATCH"
DISPATCH_TEAM_NAME = "调度"
INSPECTION_TEAM_CODE = "FACTORY-QC"
EXTERNAL_ENTRY_KINDS = ("warehouse_outbound", "inspection_shipment")
EXTERNAL_DESTINATIONS = ("库房成品", "外委库", "对外转料")

SELF_CHECK_TEAM_CODES = ("FACTORY-ENGRAVE", "FACTORY-ANNEAL", "FACTORY-GRIND", "FACTORY-WIRE")
SPLITTING_TEAM_CODES = ("FACTORY-ROLL", "FACTORY-WIRE", "FACTORY-ENGRAVE")
PROCESSING_TEAM_CODES = (
    *SPLITTING_TEAM_CODES,
    "FACTORY-ANNEAL",
    "FACTORY-GRIND",
    "FACTORY-PLATE",
    "FACTORY-QC",
)


def outbound_kinds(team):
    if team is not None:
        if team.code == WAREHOUSE_TEAM_CODE and team.kind == "warehouse":
            return ("transfer", "warehouse_outbound")
        if team.code == INSPECTION_TEAM_CODE and team.kind == "production":
            return ("transfer", "inspection_shipment")
    return ("transfer",)
