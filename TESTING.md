# Testing Guide

This project uses [pytest](https://docs.pytest.org/) for tests and
[pytest-cov](https://pytest-cov.readthedocs.io/) for coverage.

## Setup

Requires Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[test]"
```

## Running tests

| Goal                                  | Command                                              |
|---------------------------------------|------------------------------------------------------|
| Run all tests                         | `pytest`                                             |
| Verbose output (one line per test)    | `pytest -v`                                          |
| Run one file                          | `pytest tests/test_core.py`                          |
| Run one test                          | `pytest tests/test_core.py::test_divide`             |
| Run tests whose name matches a word   | `pytest -k divide`                                   |
| Stop at the first failure             | `pytest -x`                                          |
| Re-run only last failures             | `pytest --lf`                                        |
| Coverage report in the terminal       | `pytest --cov=calculator --cov-report=term-missing`  |
| Coverage report as HTML (`htmlcov/`)  | `pytest --cov=calculator --cov-report=html`          |

Pytest settings (test path, `src` on the import path) live in `pyproject.toml`
under `[tool.pytest.ini_options]`.

## Writing tests

- Put tests in `tests/`, in files named `test_*.py`, with functions named `test_*`.
- Use plain `assert` statements; pytest shows the values when an assertion fails.
- Check error cases with `pytest.raises`:

  ```python
  with pytest.raises(ZeroDivisionError):
      divide(1, 0)
  ```

- Cover several inputs with one test using `@pytest.mark.parametrize`
  (see `test_add` in `tests/test_core.py`).
- Compare floats with `pytest.approx`, since `0.1 + 0.2 != 0.3` exactly.

### Example: adding a feature with a test

1. Add the function to `src/calculator/core.py` and export it in `__init__.py`.
2. Add a test in `tests/test_core.py`:

   ```python
   def test_power():
       assert power(2, 3) == 8
   ```

3. Run `pytest` and make sure everything passes.

## Continuous integration

`.github/workflows/tests.yml` runs the suite with coverage on Python 3.10–3.13
for every push to `main` and every pull request. Results appear in the
repository's **Actions** tab and as a check on pull requests.
