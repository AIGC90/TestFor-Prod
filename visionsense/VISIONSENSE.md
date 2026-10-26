# AIGC VisionSense

VisionSense is AIGC's smart construction monitoring platform, built on
ThingsBoard Community Edition **v4.3.1.7**. That is the last ThingsBoard release
under the Apache License 2.0. From 4.4 onward ThingsBoard uses BUSL-1.1, which
does not allow removing ThingsBoard branding without a commercial license, so do
not merge upstream 4.4+ code into this tree.

Apache-2.0 requires keeping `LICENSE` and the existing copyright and SPDX headers.
New AIGC files carry their own `Copyright AIGC` header.

## What is customised

| Area | Where |
| --- | --- |
| Product name, company name, public link, 2FA issuer | `ui-ngx/src/app/shared/models/branding.constants.ts` |
| Logos (header, login, mark) | `ui-ngx/src/assets/logo_title_white.svg`, `logo_white.svg`, `assets/aigc/` |
| Favicon | `ui-ngx/src/favicon.ico`, `assets/aigc/favicon.svg` |
| Dark theme (background `#110d19`, purple `#8c70d8`, white text) | `ui-ngx/src/scss/constants.scss`, `ui-ngx/src/theme.scss`, `ui-ngx/src/scss/visionsense-dark.scss` |
| Email wording and header | `application/src/main/resources/templates/*.ftl` |
| Construction roles (server) | `application/.../service/security/permission/VisionSenseRole*.java` |
| Construction roles (UI) | `ui-ngx/src/app/shared/models/visionsense-role.models.ts`, `core/http/visionsense-role.service.ts` |

## Roles

Every user still has a ThingsBoard authority (`SYS_ADMIN`, `TENANT_ADMIN` or
`CUSTOMER_USER`). A VisionSense role is stored in the user's
`additionalInfo.vsRole` and only **narrows** what that authority allows. The
server enforces it on every permission check; the UI hides menus and Add/Delete
buttons to match.

| Role | Can do | Cannot do |
| --- | --- | --- |
| Not set / Company Admin | Everything the authority allows | — |
| Project Manager | Manage sites (customers), devices, assets, dashboards, alarms, notifications, edges; manage users ranked below them | Rule chains, device/asset profiles, platform settings |
| Site Engineer | Create and configure devices and assets, credentials, commands (RPC), alarms | Delete devices, manage users, rule chains, settings |
| Safety Officer | Acknowledge, clear and comment on alarms; send notifications | Change equipment or send commands |
| Viewer | Read dashboards, devices, assets and alarms | Any change |

Rules that prevent privilege escalation:

- Only the platform admin and unrestricted tenant admins (no role, or Company
  Admin) can grant any role or remove a role.
- Other users can only assign roles ranked below their own, to users ranked
  below their own, and cannot edit or log in as users of equal or higher rank.
- Changing a user's role signs that user out so the new role applies at once.
- An unknown role value is treated as Viewer.

Assign a role from **Users → user details → VisionSense role**. Roles are
listed by `GET /api/visionsense/roles`.

To scope people to a single construction site, create the site as a
**Customer**, assign its devices, assets and dashboards to it, and create the
site's users as customer users with the right role.

## Deploy with Docker

Everything for a single-server deployment is in `deploy/`:

| File | Purpose |
| --- | --- |
| `deploy/Dockerfile` | Builds the `aigc/visionsense` image: compiles server and UI, then puts the result into the official `thingsboard/tb-node:4.3.1.7` runtime image |
| `deploy/docker-compose.yml` | VisionSense + PostgreSQL 16, with a one-off install service |
| `deploy/.env.example` | Passwords, ports and options; copy to `.env` |

```bash
cd visionsense/deploy
cp .env.example .env          # set POSTGRES_PASSWORD; LOAD_DEMO=true adds demo data
docker compose build          # compiles inside Docker (needs internet access, ~15-30 min)
docker compose --profile install run --rm visionsense-install   # first time only
docker compose up -d
```

Then open `http://<server>:8080`. MQTT devices connect on port 1883 and CoAP on 5683/udp.

The image build needs Maven Central, the npm registry, GitHub and
`repo.thingsboard.io` (some ThingsBoard libraries are only published there).
If you build the jar elsewhere (`mvn install -pl application -am -DskipTests`), copy
`application/target/thingsboard-4.3.1.7-boot.jar` to `deploy/thingsboard.jar` and set
`VS_JAR_SOURCE=prebuilt` in `.env` to package it without compiling.

ThingsBoard's own multi-service setup (Kafka, Valkey, separate transports) remains in
`docker/` for larger deployments.

Upgrades: rebuild the image, `docker compose up -d`. Database data lives in the
`postgres-data` volume; back it up with `docker compose exec postgres pg_dump -U visionsense visionsense > backup.sql`.

## Build without Docker

Requires Java 17+, Maven 3.9 and the same network access as above.

```bash
cd visionsense
mvn clean install -DskipTests            # builds the server and the UI
```

UI only, for development against a running server:

```bash
cd visionsense/ui-ngx
yarn install
yarn start                                # http://localhost:4200, proxies /api to localhost:8080
```

Demo logins (when installed with `LOAD_DEMO=true`): `sysadmin@thingsboard.org` / `sysadmin`,
`tenant@thingsboard.org` / `tenant`. Change these before any real use.
