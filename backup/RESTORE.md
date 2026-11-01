# FleetOne full backup

Taken on 1 November 2026 from the development environment, with the Saudi sample data (SAR).

| Path | What it is |
|---|---|
| `db/erp.dump` | ERP database (trips, invoices, stock, workshop, tyres, compliance, drivers, AI history, attachments). PostgreSQL custom format. |
| `db/traccar.dump` | Traccar database (users, 25 devices, drivers, groups, geofences, 73,008 GPS positions, events). PostgreSQL custom format. |
| `screens/` | Screenshots of every main screen; open `screens/tour.html` in a browser. |
| The rest of this repository | Source code, migrations, Docker setup and docs (`git log` holds the full history). |

Both dumps were test-restored into empty databases and matched the originals row for row.

## Restore

Requires Docker, Node 22 and pnpm 10, as in the main README.

```bash
git clone https://github.com/aigc90/testfor-prod.git && cd testfor-prod
git checkout claude/fleet-platform-spec
pnpm install
pnpm infra:up                      # starts PostgreSQL and Traccar

# stop Traccar while its database is replaced
docker compose -f infra/docker-compose.yml stop traccar

# recreate both databases from the dumps
docker exec -i infra-postgres-1 psql -U fleet -d postgres -c "DROP DATABASE IF EXISTS erp WITH (FORCE)" -c "CREATE DATABASE erp OWNER fleet"
docker exec -i infra-postgres-1 psql -U fleet -d postgres -c "DROP DATABASE IF EXISTS traccar WITH (FORCE)" -c "CREATE DATABASE traccar OWNER fleet"
docker exec -i infra-postgres-1 pg_restore -U fleet -d erp --no-owner < backup/db/erp.dump
docker exec -i infra-postgres-1 pg_restore -U fleet -d traccar --no-owner < backup/db/traccar.dump

docker compose -f infra/docker-compose.yml start traccar
pnpm --filter server build && pnpm dev:server   # API on :3000
pnpm dev:web                                    # app on http://localhost:5173
pnpm simulate                                   # optional: moving trucks
```

Log in with `admin@fleet.local` / `admin`. Do not run `pnpm demo` after a restore; the sample data is already in the dump.

For the Saudi document rules, start the API with `COMPLIANCE_MANDATORY=rc,insurance,fitness,national_permit`
(see `server/.env.example`).

## Notes

- The dumps contain only sample data and the development admin login. Change the admin password
  before using a restored copy anywhere other people can reach it.
- No secrets are included: set `SECRET_KEY`, `HOOK_SECRET` and `ANTHROPIC_API_KEY` again on the new server.
