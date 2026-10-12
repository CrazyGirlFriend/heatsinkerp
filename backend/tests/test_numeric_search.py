from decimal import Decimal

import pytest
from app.record_filters import numeric_search_predicate
from sqlalchemy import create_engine, literal, select


@pytest.mark.parametrize(
    ("value", "term", "operator", "weight", "expected"),
    [
        ("12", "12", "eq", False, True),
        ("12", "13", "eq", False, False),
        ("12", "12", "gte", False, True),
        ("12", "13", "gte", False, False),
        ("12", "12", "lte", False, True),
        ("12", "11", "lte", False, False),
        ("1.0000004", "1", "eq", True, True),
        ("1.0000006", "1", "eq", True, False),
        ("-0.125", "0", "lte", True, True),
    ],
)
def test_numeric_search_preserves_operator_and_display_precision(
    value, term, operator, weight, expected
):
    engine = create_engine("sqlite://")
    try:
        with engine.connect() as connection:
            expression = numeric_search_predicate(
                literal(Decimal(value)), term, operator, weight=weight
            )
            assert connection.scalar(select(expression)) is expected
    finally:
        engine.dispose()
