"""Normalize scanner/copy typography for lookup, never rewrite saved serial IDs."""

import unicodedata

from sqlalchemy import func, or_

DASHES = "‐‑‒–—−﹣－"


def normalize_serial_query(value):
    value = unicodedata.normalize("NFKC", value).strip()
    return value.translate(str.maketrans({c: "-" for c in DASHES})).replace("\u200b", "")


def serial_text_match(column, query, mode):
    def match(expression, term):
        if mode == "exact":
            return expression == term
        escaped = term.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        return expression.like(("" if mode == "prefix" else "%") + escaped + "%", escape="!")

    normalized = func.trim(column)
    for dash in DASHES:
        normalized = func.replace(normalized, dash, "-")
    normalized = func.replace(normalized, "\u200b", "")
    return or_(match(column, query.strip()), match(normalized, normalize_serial_query(query)))
