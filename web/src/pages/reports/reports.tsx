import { Box, Card, CardActionArea, CardContent, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { http, qs } from '../../api/http';
import type { Position, TEvent } from '../../api/traccar';
import { ReportPage, type ReportConfig } from '../../components/ReportPage';
import { eventLabel, knotsToKmh } from '../../lib/fleet';
import { useDevices, useGeofences } from '../../lib/live';

export const fmtTime = (iso?: string | null) => (iso ? dayjs(iso).format('D MMM YYYY, HH:mm') : '—');
export function fmtDuration(ms: number) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
const km = (m: number) => `${(m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
const kmh = (knots: number) => `${Math.round(knotsToKmh(knots))} km/h`;
const coords = (lat?: number, lon?: number) => (lat !== undefined && lon !== undefined ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '—');

/** Names for ids used across report tables. */
function useLookups() {
  const devices = useDevices();
  const geofences = useGeofences();
  return useMemo(() => {
    const d = new Map(devices.data?.map((x) => [x.id, x.name]));
    const g = new Map(geofences.data?.map((x) => [x.id, x.name]));
    return { device: (id: number) => d.get(id) ?? `#${id}`, geofence: (id: number) => g.get(id) ?? (id ? `#${id}` : '—') };
  }, [devices.data, geofences.data]);
}
type Lookups = ReturnType<typeof useLookups>;

function eventDetail(e: TEvent, l: Lookups) {
  if (e.geofenceId) return l.geofence(e.geofenceId);
  if (e.type === 'alarm') return String(e.attributes.alarm ?? '');
  if (e.type === 'deviceOverspeed' && e.attributes.speed) return `${kmh(Number(e.attributes.speed))} (limit ${kmh(Number(e.attributes.speedLimit ?? 0))})`;
  return '';
}

/* -------------------------------------------------------------------- hub */

const HUB: { section: string; items: [string, string, string][] }[] = [
  { section: 'Fleet & activity', items: [
    ['Trips', '/reports/trips', 'Journeys with distance, duration, speed and driver.'],
    ['Stops', '/reports/stops', 'Where vehicles parked, for how long, engine hours.'],
    ['Summary', '/reports/summary', 'Distance, speed, engine hours and fuel per vehicle or per day.'],
    ['Combined', '/reports/combined', 'Routes and events together on one map.'],
  ] },
  { section: 'Tracking & analytics', items: [
    ['Route replay', '/replay', 'Play back a vehicle track on the map.'],
    ['Positions', '/reports/route', 'Raw GPS points with speed, ignition and address.'],
    ['Chart', '/reports/chart', 'Speed, fuel, battery and sensor values over time.'],
  ] },
  { section: 'Alerts & zones', items: [
    ['Events', '/reports/events', 'Overspeed, alarms, ignition and status changes.'],
    ['Geofences', '/reports/geofences', 'Zone entries, exits and time spent inside.'],
  ] },
  { section: 'System & administration', items: [
    ['Statistics', '/reports/statistics', 'Server throughput, active users and devices.'],
    ['Scheduled reports', '/reports/scheduled', 'Reports emailed automatically on a schedule.'],
    ['Logs', '/reports/logs', 'Live raw messages from trackers.'],
    ['Audit', '/reports/audit', 'Logins and changes made by users.'],
  ] },
];

export function ReportsHub() {
  const navigate = useNavigate();
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Fleet Reports & Analytics</Typography>
        <Typography color="text.secondary">Choose a report. Every table can be exported to Excel.</Typography>
      </Box>
      {HUB.map((s) => (
        <Box key={s.section}>
          <Typography variant="overline" color="text.secondary">{s.section}</Typography>
          <Grid container spacing={2}>
            {s.items.map(([title, path, text]) => (
              <Grid key={path} size={{ xs: 12, sm: 6, lg: 3 }}>
                <Card sx={{ height: '100%' }}>
                  <CardActionArea onClick={() => navigate(path)} sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6">{title}</Typography>
                      <Typography variant="body2" color="text.secondary">{text}</Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Stack>
  );
}

/* ------------------------------------------------------------------ trips */

interface TripRow {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  duration: number;
  spentFuel: number;
  driverName: string | null;
}

export function TripsReport() {
  const config: ReportConfig<TripRow> = {
    title: 'Trips',
    description: 'Each journey from ignition/motion start to stop. Click a row to see it on the map.',
    endpoint: 'trips',
    columns: [
      { label: 'Vehicle', render: (r) => r.deviceName },
      { label: 'Start', render: (r) => fmtTime(r.startTime), sort: (r) => r.startTime },
      { label: 'From', render: (r) => r.startAddress ?? coords(r.startLat, r.startLon) },
      { label: 'End', render: (r) => fmtTime(r.endTime), sort: (r) => r.endTime },
      { label: 'To', render: (r) => r.endAddress ?? coords(r.endLat, r.endLon) },
      { label: 'Distance', render: (r) => km(r.distance), sort: (r) => r.distance },
      { label: 'Duration', render: (r) => fmtDuration(r.duration), sort: (r) => r.duration },
      { label: 'Avg speed', render: (r) => kmh(r.averageSpeed), sort: (r) => r.averageSpeed },
      { label: 'Max speed', render: (r) => kmh(r.maxSpeed), sort: (r) => r.maxSpeed },
      { label: 'Driver', render: (r) => r.driverName ?? '—' },
    ],
    map: (rows, sel) => {
      const list = sel ? [sel] : rows.slice(0, 200);
      return {
        lines: list.map((r, i) => ({ id: i, coords: [[r.startLon, r.startLat], [r.endLon, r.endLat]] as [number, number][], color: sel ? '#f57c00' : '#0b5cad' })),
        points: list.flatMap((r, i) => [
          { id: i * 2, lon: r.startLon, lat: r.startLat, label: sel ? 'Start' : '', color: '#2e7d32' },
          { id: i * 2 + 1, lon: r.endLon, lat: r.endLat, label: sel ? 'End' : '', color: '#c62828' },
        ]),
      };
    },
  };
  return <ReportPage config={config} />;
}

/* ------------------------------------------------------------------ stops */

interface StopRow {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  duration: number;
  address: string | null;
  latitude: number;
  longitude: number;
  engineHours: number;
  spentFuel: number;
}

export function StopsReport() {
  const config: ReportConfig<StopRow> = {
    title: 'Stops',
    description: 'Parking and halt locations with duration and engine hours while stopped.',
    endpoint: 'stops',
    columns: [
      { label: 'Vehicle', render: (r) => r.deviceName },
      { label: 'Start', render: (r) => fmtTime(r.startTime), sort: (r) => r.startTime },
      { label: 'End', render: (r) => fmtTime(r.endTime), sort: (r) => r.endTime },
      { label: 'Duration', render: (r) => fmtDuration(r.duration), sort: (r) => r.duration },
      { label: 'Location', render: (r) => r.address ?? coords(r.latitude, r.longitude) },
      { label: 'Engine hours', render: (r) => fmtDuration(r.engineHours), sort: (r) => r.engineHours },
    ],
    map: (rows) => ({ points: rows.slice(0, 500).map((r, i) => ({ id: i, lon: r.longitude, lat: r.latitude, label: fmtDuration(r.duration), color: '#1565c0' })) }),
  };
  return <ReportPage config={config} />;
}

/* ---------------------------------------------------------------- summary */

interface SummaryRow {
  deviceId: number;
  deviceName: string;
  startTime: string;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  engineHours: number;
  spentFuel: number;
  startOdometer: number;
  endOdometer: number;
}

export function SummaryReport() {
  const config: ReportConfig<SummaryRow> = {
    title: 'Summary',
    description: 'Totals per vehicle for the period, or per vehicle per day.',
    endpoint: 'summary',
    params: (f) => ({ daily: Boolean(f.extra.daily) }),
    extraFilters: (v, set) => (
      <TextField select size="small" label="Grouping" value={v.daily ? 'daily' : 'total'} onChange={(e) => set({ ...v, daily: e.target.value === 'daily' })} sx={{ minWidth: 150 }}>
        <MenuItem value="total">Whole period</MenuItem>
        <MenuItem value="daily">Per day</MenuItem>
      </TextField>
    ),
    columns: [
      { label: 'Vehicle', render: (r) => r.deviceName },
      { label: 'Date', render: (r) => dayjs(r.startTime).format('D MMM YYYY'), sort: (r) => r.startTime },
      { label: 'Distance', render: (r) => km(r.distance), sort: (r) => r.distance },
      { label: 'Avg speed', render: (r) => kmh(r.averageSpeed), sort: (r) => r.averageSpeed },
      { label: 'Max speed', render: (r) => kmh(r.maxSpeed), sort: (r) => r.maxSpeed },
      { label: 'Engine hours', render: (r) => fmtDuration(r.engineHours), sort: (r) => r.engineHours },
      { label: 'Fuel spent', render: (r) => `${(r.spentFuel ?? 0).toFixed(1)}`, sort: (r) => r.spentFuel },
      { label: 'Start odometer', render: (r) => km(r.startOdometer), sort: (r) => r.startOdometer },
      { label: 'End odometer', render: (r) => km(r.endOdometer), sort: (r) => r.endOdometer },
    ],
  };
  return <ReportPage config={config} />;
}

/* ------------------------------------------------------------- positions */

export function RouteReport() {
  const l = useLookups();
  const config: ReportConfig<Position> = {
    title: 'Route & Positions',
    description: 'Every GPS point recorded for the selected vehicles.',
    endpoint: 'route',
    rowKey: (r) => r.id,
    columns: [
      { label: 'Vehicle', render: (r) => l.device(r.deviceId) },
      { label: 'Fix time', render: (r) => fmtTime(r.fixTime), sort: (r) => r.fixTime },
      { label: 'Latitude', render: (r) => r.latitude.toFixed(6) },
      { label: 'Longitude', render: (r) => r.longitude.toFixed(6) },
      { label: 'Speed', render: (r) => kmh(r.speed), sort: (r) => r.speed },
      { label: 'Ignition', render: (r) => (r.attributes.ignition ? 'On' : 'Off') },
      { label: 'Fuel', render: (r) => (r.attributes.fuel !== undefined ? String(r.attributes.fuel) : '—') },
      { label: 'Address', render: (r) => r.address ?? '—' },
    ],
    map: (rows, sel) => {
      const byDevice = new Map<number, [number, number][]>();
      rows.forEach((p) => byDevice.set(p.deviceId, [...(byDevice.get(p.deviceId) ?? []), [p.longitude, p.latitude]]));
      return {
        lines: [...byDevice.entries()].map(([id, c]) => ({ id, coords: c })),
        points: sel ? [{ id: sel.id, lon: sel.longitude, lat: sel.latitude, label: fmtTime(sel.fixTime), color: '#f57c00' }] : [],
      };
    },
  };
  return <ReportPage config={config} />;
}

/* ----------------------------------------------------------------- events */

const EVENT_TYPES = [
  'deviceOnline', 'deviceOffline', 'deviceMoving', 'deviceStopped', 'deviceOverspeed', 'deviceFuelDrop', 'deviceFuelIncrease',
  'geofenceEnter', 'geofenceExit', 'alarm', 'ignitionOn', 'ignitionOff', 'maintenance', 'driverChanged', 'commandResult',
];

export function EventsReport() {
  const l = useLookups();
  const config: ReportConfig<TEvent> = {
    title: 'Events',
    description: 'Overspeed, alarms, ignition, geofence and status changes.',
    endpoint: 'events',
    rowKey: (r) => r.id,
    params: (f) => ({ type: (f.extra.types as string[] | undefined)?.length ? (f.extra.types as string[]) : ['allEvents'] }),
    extraFilters: (v, set) => (
      <TextField
        select
        size="small"
        label="Event types"
        value={(v.types as string[] | undefined) ?? []}
        onChange={(e) => set({ ...v, types: e.target.value as unknown as string[] })}
        slotProps={{ select: { multiple: true, renderValue: (s) => ((s as string[]).length ? `${(s as string[]).length} selected` : 'All') } }}
        sx={{ minWidth: 170 }}
      >
        {EVENT_TYPES.map((t) => <MenuItem key={t} value={t}>{eventLabel(t)}</MenuItem>)}
      </TextField>
    ),
    columns: [
      { label: 'Vehicle', render: (r) => l.device(r.deviceId) },
      { label: 'Time', render: (r) => fmtTime(r.eventTime), sort: (r) => r.eventTime },
      { label: 'Event', render: (r) => eventLabel(r.type) },
      { label: 'Details', render: (r) => eventDetail(r, l) },
    ],
  };
  return <ReportPage config={config} />;
}

/* -------------------------------------------------------------- geofences */

interface GeofenceRow {
  deviceId: number;
  geofenceId: number;
  startTime: string;
  endTime: string | null;
}

export function GeofencesReport() {
  const l = useLookups();
  const config: ReportConfig<GeofenceRow> = {
    title: 'Geofences',
    description: 'When vehicles entered and left each zone, and how long they stayed.',
    endpoint: 'geofences',
    columns: [
      { label: 'Vehicle', render: (r) => l.device(r.deviceId) },
      { label: 'Zone', render: (r) => l.geofence(r.geofenceId) },
      { label: 'Entered', render: (r) => fmtTime(r.startTime), sort: (r) => r.startTime },
      { label: 'Left', render: (r) => (r.endTime ? fmtTime(r.endTime) : 'Still inside') },
      { label: 'Time inside', render: (r) => (r.endTime ? fmtDuration(dayjs(r.endTime).diff(r.startTime)) : '—'), sort: (r) => (r.endTime ? dayjs(r.endTime).diff(r.startTime) : 0) },
    ],
  };
  return <ReportPage config={config} />;
}

/* --------------------------------------------------------------- combined */

interface CombinedItem {
  deviceId: number;
  route: [number, number][];
  events: TEvent[];
}
interface CombinedRow {
  deviceId: number;
  event: TEvent;
  route: [number, number][];
}

export function CombinedReport() {
  const l = useLookups();
  const config: ReportConfig<CombinedRow> = {
    title: 'Combined',
    description: 'Routes and events for the selected vehicles on one map.',
    endpoint: 'combined',
    load: async (f) => {
      const items = await http<CombinedItem[]>(`/api/reports/combined?${qs({ deviceId: f.deviceIds, groupId: f.groupIds, from: f.from, to: f.to })}`);
      return items.flatMap((it) => it.events.map((event) => ({ deviceId: it.deviceId, event, route: it.route })));
    },
    rowKey: (r) => r.event.id,
    columns: [
      { label: 'Vehicle', render: (r) => l.device(r.deviceId) },
      { label: 'Time', render: (r) => fmtTime(r.event.eventTime), sort: (r) => r.event.eventTime },
      { label: 'Event', render: (r) => eventLabel(r.event.type) },
      { label: 'Details', render: (r) => eventDetail(r.event, l) },
    ],
    map: (rows) => {
      const routes = new Map(rows.map((r) => [r.deviceId, r.route]));
      return { lines: [...routes.entries()].map(([id, c]) => ({ id, coords: c })) };
    },
  };
  return <ReportPage config={config} />;
}

/* ------------------------------------------------------------------ chart */

const METRICS: [string, string, (p: Position) => number | undefined][] = [
  ['speed', 'Speed (km/h)', (p) => knotsToKmh(p.speed)],
  ['fuel', 'Fuel', (p) => (p.attributes.fuel as number | undefined)],
  ['altitude', 'Altitude (m)', (p) => (p as Position & { altitude?: number }).altitude],
  ['batteryLevel', 'Battery (%)', (p) => p.attributes.batteryLevel],
  ['power', 'External power (V)', (p) => p.attributes.power as number | undefined],
  ['odometer', 'Odometer (km)', (p) => (p.attributes.odometer !== undefined ? p.attributes.odometer / 1000 : undefined)],
];

export function ChartReport() {
  const l = useLookups();
  const metricOf = (v: Record<string, unknown>) => METRICS.find((m) => m[0] === v.metric) ?? METRICS[0];
  const config: ReportConfig<Position & { value?: number }> = {
    title: 'Chart Analytics',
    description: 'Plot speed, fuel, battery and other sensor values over time.',
    endpoint: 'route',
    load: async (f) => {
      const list = await http<Position[]>(`/api/reports/route?${qs({ deviceId: f.deviceIds, groupId: f.groupIds, from: f.from, to: f.to })}`);
      const metric = metricOf(f.extra);
      return list.map((p) => ({ ...p, value: metric[2](p) }));
    },
    extraFilters: (v, set) => (
      <TextField select size="small" label="Metric" value={(v.metric as string) ?? 'speed'} onChange={(e) => set({ ...v, metric: e.target.value })} sx={{ minWidth: 170 }}>
        {METRICS.map(([k, label]) => <MenuItem key={k} value={k}>{label}</MenuItem>)}
      </TextField>
    ),
    header: (rows) => (
      <Card>
        <CardContent sx={{ height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={rows.filter((r) => r.value !== undefined).map((r) => ({ t: dayjs(r.fixTime).format('D MMM HH:mm'), v: r.value, d: l.device(r.deviceId) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" fontSize={11} minTickGap={40} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="v" stroke="#0b5cad" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    ),
    rowKey: (r) => r.id,
    columns: [
      { label: 'Vehicle', render: (r) => l.device(r.deviceId) },
      { label: 'Time', render: (r) => fmtTime(r.fixTime), sort: (r) => r.fixTime },
      { label: 'Value', render: (r) => (r.value === undefined ? '—' : Number(r.value.toFixed(2))), sort: (r) => r.value ?? 0 },
    ],
  };
  return <ReportPage config={config} />;
}

/* ------------------------------------------------------------- statistics */

interface StatRow {
  captureTime: string;
  activeUsers: number;
  activeDevices: number;
  requests: number;
  messagesReceived: number;
  messagesStored: number;
  mailSent: number;
  smsSent: number;
  geocoderRequests: number;
}

export function StatisticsReport() {
  const config: ReportConfig<StatRow> = {
    title: 'Statistics',
    description: 'Daily server activity: users, devices, API requests and messages.',
    scope: 'none',
    load: (f) => http<StatRow[]>(`/api/statistics?${qs({ from: f.from, to: f.to })}`),
    header: (rows) => (
      <Grid container spacing={2}>
        {([
          ['Peak active devices', Math.max(0, ...rows.map((r) => r.activeDevices))],
          ['Peak active users', Math.max(0, ...rows.map((r) => r.activeUsers))],
          ['Messages received', rows.reduce((s, r) => s + r.messagesReceived, 0)],
          ['API requests', rows.reduce((s, r) => s + r.requests, 0)],
        ] as [string, number][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}>
            <Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h5">{v.toLocaleString('en-IN')}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>
    ),
    columns: [
      { label: 'Date', render: (r) => dayjs(r.captureTime).format('D MMM YYYY'), sort: (r) => r.captureTime },
      { label: 'Active users', render: (r) => r.activeUsers },
      { label: 'Active devices', render: (r) => r.activeDevices },
      { label: 'Messages received', render: (r) => r.messagesReceived },
      { label: 'Messages stored', render: (r) => r.messagesStored },
      { label: 'Requests', render: (r) => r.requests },
      { label: 'Emails', render: (r) => r.mailSent },
      { label: 'SMS', render: (r) => r.smsSent },
    ],
  };
  return <ReportPage config={config} />;
}

/* ------------------------------------------------------------------ audit */

interface AuditRow {
  id: number;
  actionTime: string;
  address: string;
  userId: number;
  userEmail?: string;
  actionType: string;
  objectType: string | null;
  objectId: number;
}

export function AuditReport() {
  const config: ReportConfig<AuditRow> = {
    title: 'Audit Trail',
    description: 'Logins, failed logins and changes made by users.',
    scope: 'none',
    load: (f) => http<AuditRow[]>(`/api/audit?${qs({ from: f.from, to: f.to })}`),
    rowKey: (r) => r.id,
    columns: [
      { label: 'Time', render: (r) => fmtTime(r.actionTime), sort: (r) => r.actionTime },
      { label: 'Account', render: (r) => r.userEmail ?? (r.userId ? `User #${r.userId}` : 'Anonymous') },
      {
        label: 'Action',
        render: (r) => <Chip size="small" label={r.actionType} color={r.actionType === 'denied' ? 'error' : r.actionType === 'remove' ? 'warning' : 'default'} />,
        sort: (r) => r.actionType,
      },
      { label: 'Object', render: (r) => (r.objectType ? `${r.objectType} #${r.objectId}` : '—') },
      { label: 'IP address', render: (r) => r.address },
    ],
  };
  return <ReportPage config={config} />;
}

