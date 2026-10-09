"""Stable directory identity; no warehouse process-route concepts."""
WAREHOUSE_TEAM_CODE = "FACTORY-WAREHOUSE"
WAREHOUSE_TEAM_NAME = "库房"
INSPECTION_TEAM_CODE = "FACTORY-QC"
REALLOCATION_TEAM_CODES = (WAREHOUSE_TEAM_CODE, INSPECTION_TEAM_CODE, "FACTORY-PLATE")
EXTERNAL_ENTRY_KINDS = ("warehouse_outbound", "inspection_shipment")
