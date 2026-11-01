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

See [docs/handover.md](docs/handover.md) for a test plan per module.

## Modules

| Area | Screens |
|---|---|
| Live operations | Dashboard, live map, route replay, notifications, geofences, dashcam, SOS desk |
| Operations & trips | Trips (GPS progress, ETA, e-POD), customers & orders, LR register, loading sheet upload, freight memos, fuel indents, incoming vehicles, material received, revenue & receivables, FASTag, subscriptions |
| Inventory | Item master, stock by store, movements, requests, goods to receive, opening stock, sales, group loans, GL settings |
| Tyres | Overview, axle map & fitment, register & history, interchanges, NSD alerts, cost per km, performance |
| Workshop | Hub, job cards, PM schedules (GPS km), gate passes, repair bills (GST/TDS), tool checklists, driver charges, pending inbox |
| People & compliance | Statutory documents, safety & claims, field staff, driver management (assignment, hours, attendance, payroll) |
| Analytics | AI Ops, fleet executive BI, Traccar reports |
| Admin | Users & ERP roles, document permissions, field masks, approval rules (Pending Inbox → Rules), integrations |

Documents that need sign-off (fuel indents, job cards, repair bills, payroll, expense claims,
AI proposals...) go to the Pending Inbox according to the approval rules.

## Environment

Set these on the API server (`server/`). Only `DATABASE_URL`, `TRACCAR_URL`, `HOOK_SECRET`
and `SECRET_KEY` are needed to run; the rest switch on optional features.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL for the ERP (default `postgres://fleet:fleet@localhost:5432/erp`) |
| `TRACCAR_URL` | Traccar base URL (default `http://localhost:8082`) |
| `HOOK_SECRET` | Shared secret Traccar sends with forwarded events (SOS, geofence arrival) |
| `SECRET_KEY` | Encrypts stored connector tokens. **Set in production.** |
| `ANTHROPIC_API_KEY` | Turns on the AI features. Keep it in an environment secret, never in the repo. |
| `AI_MODEL` | Default `claude-opus-5-5` |
| `AI_BRIEFING_HOUR`, `TRACCAR_SERVICE_EMAIL`, `TRACCAR_SERVICE_PASSWORD` | Daily AI briefing after this hour (IST), read with a Traccar service login |
| `VAHAN_API_URL`, `VAHAN_API_KEY` | Vahan / ULIP aggregator for RC, insurance, fitness, PUC, permits |
| `FASTAG_API_URL`, `FASTAG_API_KEY` | FASTag issuer or aggregator for balances and toll transactions (otherwise import bank statements) |
| `DASHCAM_STREAM_URL` | Video media server URL template, e.g. `https://media.example.com/live/{uniqueId}/{channel}.m3u8` |
| `MAX_UPLOAD_BYTES` | Attachment size limit (default 8 MB) |

## AI features

With `ANTHROPIC_API_KEY` set:

- **Copilot** (✨ in the top bar): answers questions from live data through read-only tools
  that respect the user's role. Aadhar and phone numbers are masked before they reach the model.
- **Actions through approvals**: the copilot can *propose* job cards, PM job cards, driver
  assignments, field tasks and incidents. Each proposal waits in the Pending Inbox and runs only
  after a person approves it. Vehicle commands (engine stop/resume) are never available to AI.
- **AI Ops** (Reports & analytics → AI Ops): alert triage across GPS events, SOS, tread depth,
  compliance, maintenance, FASTag and receivables; the morning briefing; a log of proposals;
  token usage.
- **Document AI**: on compliance documents and repair bills, attach a scan and click
  *Read with AI*. The suggested fields are shown for review and applied only when you click Apply.

Without the key everything else works and the AI screens say AI is off.

## flespi integration

Trackers connected to a [flespi.io](https://flespi.io) account can feed this platform:
Settings → Integrations (flespi). Save a flespi token and the public host of your Traccar
server, import the flespi devices (their `ident` becomes the Traccar unique ID), then create
the stream. flespi pushes messages to Traccar's flespi port **5149**, which must be reachable
from the internet. Commands to these trackers are sent from flespi (the stream is one-way).
Set `SECRET_KEY` in production; it encrypts stored connector tokens.

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
