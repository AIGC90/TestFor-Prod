#!/usr/bin/env node
// Seeds a fresh Traccar server with an admin account and a demo fleet.
// Safe to re-run: existing records (matched by name / uniqueId) are skipped.
//
//   TRACCAR_URL=http://localhost:8082 ADMIN_EMAIL=admin@fleet.local ADMIN_PASSWORD=admin node tools/seed-traccar.mjs

import { CITIES, DRIVERS, GEOFENCES, GROUPS, LEGACY_GEOFENCES, LEGACY_GROUPS, demoVehicles } from './fleet-data.mjs';

const BASE = process.env.TRACCAR_URL ?? 'http://localhost:8082';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@fleet.local';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';
const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64');

async function api(method, path, body, auth = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(auth ? { Authorization: AUTH } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function ensureAdmin() {
  const probe = await fetch(BASE + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD }),
  });
  if (probe.ok) return;
  // Traccar makes the first registered user an administrator.
  await api('POST', '/api/users', { name: 'Administrator', email: EMAIL, password: PASSWORD }, false);
  console.log('created admin', EMAIL);
}

/**
 * Creates missing records. With `update`, records that exist but differ (e.g. a device renamed in a new
 * demo dataset) are updated in place, which keeps their history and positions.
 */
async function ensureMany(path, items, key, { update = false } = {}) {
  const existing = await api('GET', path);
  const byKey = new Map(existing.map((e) => [e[key], e]));
  const out = [];
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const found = byKey.get(item[key]);
    if (!found) {
      out.push(await api('POST', path, item));
      created++;
    } else if (update && Object.entries(item).some(([k, v]) => JSON.stringify(found[k]) !== JSON.stringify(v))) {
      out.push(await api('PUT', `${path}/${found.id}`, { ...found, ...item }));
      updated++;
    } else out.push(found);
  }
  console.log(`${path}: ${out.length} (${created} new, ${updated} updated)`);
  return out;
}

/** Removes records left over from an earlier demo dataset. */
async function removeNamed(path, names) {
  for (const e of await api('GET', path)) {
    if (names.includes(e.name)) {
      await api('DELETE', `${path}/${e.id}`);
      console.log(`removed ${path} ${e.name}`);
    }
  }
}

async function link(body) {
  try {
    await api('POST', '/api/permissions', body);
  } catch (e) {
    if (!String(e.message).includes('duplicate')) throw e;
  }
}

await ensureAdmin();

const groups = await ensureMany('/api/groups', GROUPS.map((name) => ({ name })), 'name');
const groupId = Object.fromEntries(groups.map((g) => [g.name, g.id]));

await ensureMany(
  '/api/devices',
  demoVehicles().map((v) => ({
    name: v.name,
    uniqueId: v.uniqueId,
    model: v.model,
    category: v.category,
    phone: v.phone,
    groupId: groupId[v.group],
    attributes: { sellType: 'rent', operator: 'STC', speedLimit: 43.2 }, // 80 km/h in knots
  })),
  'uniqueId',
  { update: true },
);
await removeNamed('/api/groups', LEGACY_GROUPS);

await ensureMany(
  '/api/drivers',
  DRIVERS.map((name, i) => ({ name, uniqueId: `DRV-${String(i + 1).padStart(3, '0')}` })),
  'uniqueId',
  { update: true },
);
await removeNamed('/api/geofences', LEGACY_GEOFENCES);

const geofences = await ensureMany(
  '/api/geofences',
  GEOFENCES.map(([name, city]) => {
    const [lat, lon] = CITIES[city];
    return { name, description: `Hub at ${city}`, area: `CIRCLE (${lat} ${lon}, 3000)` };
  }),
  'name',
);
for (const g of groups) for (const f of geofences) await link({ groupId: g.id, geofenceId: f.id });

await ensureMany(
  '/api/notifications',
  [
    ['deviceOverspeed', 'web,mail'],
    ['geofenceEnter', 'web'],
    ['geofenceExit', 'web'],
    ['alarm', 'web,mail'],
    ['ignitionOn', 'web'],
    ['deviceStopped', 'web'],
    ['maintenance', 'web,mail'],
  ].map(([type, notificators]) => ({ type, notificators, always: true, attributes: {} })),
  'type',
);

await ensureMany(
  '/api/maintenance',
  [
    ['Engine Oil & Filter Service', 'odometer', 0, 15000000],
    ['Hub Greasing & Brake Inspection', 'odometer', 0, 20000000],
    ['Transmission & Differential Fluid', 'odometer', 0, 40000000],
  ].map(([name, type, start, period]) => ({ name, type, start, period, attributes: {} })),
  'name',
);

console.log('Seed complete. Log in with', EMAIL);
