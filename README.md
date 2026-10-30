# FleetOne — fleet management platform

GPS tracking (Traccar) plus fleet ERP: trips, stores, tyres, workshop, compliance and finance.
The full feature spec is in [docs/fleet-platform-spec.md](docs/fleet-platform-spec.md).

## Layout

```
infra/     docker compose: PostgreSQL + Traccar
server/    NestJS + Drizzle API for ERP modules (served under /erp)
web/       React + MUI single-page app (Vite)
tools/     Traccar seeder and GPS simulator
```

The browser talks to one origin: `/api/*` is proxied to Traccar (including the live
WebSocket) and `/erp/*` to the API. Login is the Traccar session; the API checks it on
every request and adds ERP roles.

## Run locally

Requires Docker, Node 22 and pnpm 10.

```bash
pnpm install
pnpm infra:up                  # PostgreSQL :5432, Traccar :8082
node tools/seed-traccar.mjs    # admin@fleet.local / admin + demo fleet
pnpm --filter server build && pnpm dev:server   # API on :3000
pnpm dev:web                   # app on http://localhost:5173
pnpm simulate                  # optional: moving demo trucks
```

## Checks

```bash
pnpm typecheck
pnpm test        # server tests need the PostgreSQL from infra/
pnpm build
```

---

# Calculator sandbox (Vision Sense - SCM) 

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
