"""Shared HTTP errors for the active API modules."""
from fastapi import HTTPException


def not_found(resource: str) -> HTTPException:
    return HTTPException(404, f"{resource} not found")


def conflict(message: str) -> HTTPException:
    return HTTPException(409, message)
