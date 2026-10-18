import pytest

from calculator import add, divide, mean, multiply, subtract


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(1, 2, 3), (-1, 1, 0), (0, 0, 0), (2.5, 0.5, 3.0)],
)
def test_add(a, b, expected):
    assert add(a, b) == expected


def test_subtract():
    assert subtract(10, 4) == 6
    assert subtract(4, 10) == -6


def test_multiply():
    assert multiply(3, 4) == 12
    assert multiply(-2, 5) == -10
    assert multiply(7, 0) == 0


def test_divide():
    assert divide(10, 4) == 2.5
    assert divide(-9, 3) == -3


def test_divide_by_zero_raises():
    with pytest.raises(ZeroDivisionError, match="cannot divide by zero"):
        divide(1, 0)


def test_mean():
    assert mean([1, 2, 3, 4]) == 2.5
    assert mean(x for x in (5, 5, 5)) == 5


def test_mean_of_empty_raises():
    with pytest.raises(ValueError):
        mean([])


def test_float_precision():
    assert add(0.1, 0.2) == pytest.approx(0.3)
