# TestFor-Prod

A small Python calculator package with a pytest test suite and GitHub Actions CI.
It is a sandbox for trying out testing workflows.

## Project layout

```
src/calculator/       Package source
  core.py             add, subtract, multiply, divide, mean
tests/                pytest test suite
.github/workflows/    CI that runs the tests on every push and pull request
TESTING.md            How to run and write tests
```

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[test]"
pytest
```

## Usage

```python
from calculator import add, divide, mean

add(2, 3)          # 5
divide(10, 4)      # 2.5
mean([1, 2, 3])    # 2.0
divide(1, 0)       # raises ZeroDivisionError
```

See [TESTING.md](TESTING.md) for the full testing guide.
