#!/usr/bin/env node
// Drives the demo fleet along Indian freight corridors and reports positions to
// Traccar over the OsmAnd HTTP protocol (port 5055). Most trucks move, a few idle,
// a few are parked with ignition off and a few stay offline, so every dashboard
// state has data.
//
//   OSMAND_URL=http://localhost:5055 INTERVAL=10 SPEEDUP=20 node tools/simulate-gps.mjs
//   ONCE=1 node tools/simulate-gps.mjs   # send a single round and exit (used in tests)

import { CITIES, CORRIDORS, DRIVERS, demoVehicles } from './fleet-data.mjs';

const URL_BASE = process.env.OSMAND_URL ?? 'http://localhost:5055';
const INTERVAL = Number(process.env.INTERVAL ?? 10); // seconds between reports
const SPEEDUP = Number(process.env.SPEEDUP ?? 20); // distance multiplier so movement is visible
const ONCE = process.env.ONCE === '1';

const KNOTS_PER_KMH = 0.539957;
const toRad = (d) => (d * Math.PI) / 180;

function distanceKm([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function bearing([lat1, lon1], [lat2, lon2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Build a back-and-forth polyline for each corridor.
const routes = CORRIDORS.map((cities) => {
  const pts = cities.map((c) => CITIES[c]);
  return [...pts, ...pts.slice(0, -1).reverse()];
});

const vehicles = demoVehicles().map((v, i) => ({
  ...v,
  mode: i < 16 ? 'moving' : i < 19 ? 'idle' : i < 22 ? 'parked' : 'offline',
  route: routes[v.corridor],
  leg: i % 2,
  progress: (i * 0.137) % 1, // fraction along current leg
  odometerKm: 20000 + i * 3150,
  fuel: 60 + (i % 5) * 8,
  driver: `DRV-${String((i % DRIVERS.length) + 1).padStart(3, '0')}`,
}));

function step(v) {
  const from = v.route[v.leg];
  const to = v.route[(v.leg + 1) % v.route.length];
  let speedKmh = 0;
  if (v.mode === 'moving') {
    speedKmh = 45 + Math.random() * 40; // occasionally over the 80 km/h limit
    const legKm = distanceKm(from, to);
    const moveKm = (speedKmh * INTERVAL * SPEEDUP) / 3600;
    v.progress += moveKm / legKm;
    v.odometerKm += moveKm;
    v.fuel = Math.max(5, v.fuel - moveKm * 0.03);
    if (v.progress >= 1) {
      v.progress = 0;
      v.leg = (v.leg + 1) % (v.route.length - 1 || 1);
    }
  }
  const a = v.route[v.leg];
  const b = v.route[(v.leg + 1) % v.route.length];
  const lat = a[0] + (b[0] - a[0]) * v.progress;
  const lon = a[1] + (b[1] - a[1]) * v.progress;
  return {
    id: v.uniqueId,
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    timestamp: Math.floor(Date.now() / 1000),
    speed: (speedKmh * KNOTS_PER_KMH).toFixed(1),
    bearing: bearing(a, b).toFixed(0),
    altitude: 300,
    accuracy: 5,
    batt: 95,
    ignition: v.mode !== 'parked',
    motion: v.mode === 'moving',
    odometer: Math.round(v.odometerKm * 1000),
    fuel: v.fuel.toFixed(1),
    driverUniqueId: v.driver,
  };
}

async function report(v) {
  if (v.mode === 'offline') return;
  const params = new URLSearchParams(Object.entries(step(v)).map(([k, val]) => [k, String(val)]));
  try {
    await fetch(`${URL_BASE}/?${params}`, { method: 'POST' });
  } catch (e) {
    console.error(`report failed for ${v.name}: ${e.message}`);
  }
}

async function round() {
  await Promise.all(vehicles.map(report));
}

await round();
console.log(`sent positions for ${vehicles.filter((v) => v.mode !== 'offline').length} vehicles`);
if (!ONCE) setInterval(round, INTERVAL * 1000);
