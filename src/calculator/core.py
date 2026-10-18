"""Basic arithmetic operations."""

from collections.abc import Iterable

Number = int | float


def add(a: Number, b: Number) -> Number:
    """Return the sum of a and b."""
    return a + b


def subtract(a: Number, b: Number) -> Number:
    """Return a minus b."""
    return a - b


def multiply(a: Number, b: Number) -> Number:
    """Return the product of a and b."""
    return a * b


def divide(a: Number, b: Number) -> float:
    """Return a divided by b.

    Raises:
        ZeroDivisionError: if b is zero.
    """
    if b == 0:
        raise ZeroDivisionError("cannot divide by zero")
    return a / b


def mean(values: Iterable[Number]) -> float:
    """Return the arithmetic mean of values.

    Raises:
        ValueError: if values is empty.
    """
    items = list(values)
    if not items:
        raise ValueError("mean() requires at least one value")
    return sum(items) / len(items)
