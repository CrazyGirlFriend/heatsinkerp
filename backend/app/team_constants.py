"""Stable directory identity; no warehouse process-route concepts."""

WAREHOUSE_TEAM_CODE = "FACTORY-WAREHOUSE"
WAREHOUSE_TEAM_NAME = "库房"
INSPECTION_TEAM_CODE = "FACTORY-QC"
EXTERNAL_ENTRY_KINDS = ("warehouse_outbound", "inspection_shipment")
EXTERNAL_DESTINATIONS = ("库房成品", "外委库", "对外转料")

SPLITTING_TEAM_CODES = ("FACTORY-ROLL", "FACTORY-WIRE", "FACTORY-ENGRAVE")
PROCESSING_TEAM_CODES = (
    *SPLITTING_TEAM_CODES,
    "FACTORY-ANNEAL",
    "FACTORY-GRIND",
    "FACTORY-PLATE",
    "FACTORY-QC",
)
