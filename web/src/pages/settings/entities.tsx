import { Chip } from '@mui/material';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { http } from '../../api/http';
import type { Device, Driver, Group } from '../../api/traccar';
import { EntityPage, type EntityConfig, type Option } from '../../components/EntityPage';
import { eventLabel } from '../../lib/fleet';
import { DeviceBulkUpload } from './DeviceBulkUpload';

dayjs.extend(utc);

const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const typeOptions = (path: string, label: (t: string) => string = humanize) => async (): Promise<Option[]> =>
  (await http<{ type: string }[]>(path)).map(({ type }) => ({ value: type, label: label(type) }));
const groupOptions = async (): Promise<Option[]> => (await http<Group[]>('/api/groups')).map((g) => ({ value: g.id, label: g.name }));
const calendarOptions = async (): Promise<Option[]> =>
  (await http<{ id: number; name: string }[]>('/api/calendars')).map((c) => ({ value: c.id, label: c.name }));
const date = (v: string | null | undefined) => (v ? dayjs(v).format('D MMM YYYY') : '—');
const attr = (row: { attributes: Record<string, unknown> }, key: string) => (row.attributes?.[key] as string | undefined) ?? '—';

export const CATEGORIES: Option[] = [
  'truck', 'van', 'car', 'bus', 'pickup', 'tractor', 'crane', 'trailer', 'motorcycle', 'boat', 'person', 'default',
].map((c) => ({ value: c, label: humanize(c) }));
const OPERATORS: Option[] = ['Airtel', 'Jio', 'Vi (Vodafone Idea)', 'BSNL', 'MTNL', 'Other'].map((o) => ({ value: o, label: o }));

/* ------------------------------------------------------------------ devices */

type DeviceRow = Device;

const groupName = (() => {
  let cache: Map<number, string> | null = null;
  return {
    async load() {
      try {
        cache = new Map((await http<Group[]>('/api/groups')).map((g) => [g.id, g.name]));
      } catch {
        // group names are cosmetic in the list
      }
    },
    get: (id: number) => cache?.get(id) ?? '—',
  };
})();

export const devicesConfig: EntityConfig<DeviceRow> = {
  title: 'Devices',
  singular: 'device',
  subtitle: 'GPS hardware units, IMEI identifiers, SIM cards and group allocation.',
  endpoint: '/api/devices',
  queryKey: 'devices',
  defaults: { category: 'truck', attributes: { sellType: 'rent', operator: 'Airtel' } } as Partial<DeviceRow>,
  searchText: (d) => `${d.name} ${d.uniqueId} ${d.model ?? ''} ${d.phone ?? ''} ${JSON.stringify(d.attributes)}`,
  columns: [
    { label: 'Name', render: (d) => d.name },
    { label: 'IMEI', render: (d) => d.uniqueId },
    { label: 'Status', render: (d) => <Chip size="small" label={d.status} color={d.status === 'online' ? 'success' : 'default'} />, csv: (d) => d.status },
    { label: 'Sell type', render: (d) => humanize(String(d.attributes?.sellType ?? '—')) },
    { label: 'Type', render: (d) => humanize(d.category ?? 'default') },
    { label: 'Model', render: (d) => d.model ?? '—' },
    { label: 'Customer', render: (d) => attr(d, 'customer') },
    { label: 'SIM / MDN', render: (d) => d.phone ?? attr(d, 'mdn') },
    { label: 'Operator', render: (d) => attr(d, 'operator') },
    { label: 'Expiry', render: (d) => date(d.expirationTime) },
    { label: 'Group', render: (d) => groupName.get(d.groupId) },
    { label: 'Last seen', render: (d) => (d.lastUpdate ? dayjs(d.lastUpdate).format('D MMM, HH:mm') : 'Never') },
  ],
  fields: [
    { section: '1. Identity & commercial', path: 'name', label: 'Name / vehicle no.', required: true },
    { section: '1. Identity & commercial', path: 'uniqueId', label: 'IMEI / identifier', required: true, helper: 'Primary hardware tracking identifier' },
    { section: '1. Identity & commercial', path: 'attributes.sellType', label: 'Sell type', type: 'select', options: [{ value: 'rent', label: 'Rent (subscription)' }, { value: 'sale', label: 'Sale (outright)' }] },
    { section: '1. Identity & commercial', path: 'attributes.customer', label: 'Customer name' },
    { section: '2. Asset & hardware', path: 'category', label: 'Asset type', type: 'select', options: CATEGORIES },
    { section: '2. Asset & hardware', path: 'model', label: 'Model' },
    { section: '2. Asset & hardware', path: 'groupId', label: 'Group', type: 'select', options: groupOptions, optionsKey: 'groups' },
    { section: '2. Asset & hardware', path: 'odometerKm', label: 'Set odometer (km)', type: 'number', helper: 'Leave blank to keep the current reading', visible: (v) => Number(v.positionId) > 0 },
    { section: '3. SIM & telecom', path: 'attributes.iccid', label: 'SIM number (ICCID)' },
    { section: '3. SIM & telecom', path: 'phone', label: 'MDN (SIM mobile number)' },
    { section: '3. SIM & telecom', path: 'attributes.operator', label: 'Operator', type: 'select', options: OPERATORS },
    { section: '3. SIM & telecom', path: 'contact', label: 'Contact person' },
    { section: '4. Validity', path: 'expirationTime', label: 'Expiry date', type: 'date' },
    { section: '4. Validity', path: 'attributes.speedLimit', label: 'Speed limit (km/h)', type: 'number', scale: 0.539957 },
    { section: '4. Validity', path: 'disabled', label: 'Disabled (stop accepting data)', type: 'switch' },
  ],
  omitOnSave: ['odometerKm'],
  afterSave: async (saved, values) => {
    const km = values.odometerKm;
    if (km !== null && km !== undefined && km !== '') {
      await http(`/api/devices/${saved.id}/accumulators`, {
        method: 'PUT',
        body: JSON.stringify({ deviceId: saved.id, totalDistance: Number(km) * 1000 }),
      });
    }
  },
  toolbar: <DeviceBulkUpload />,
};

export function DevicesPage() {
  void groupName.load();
  return <EntityPage config={devicesConfig} />;
}

/* ------------------------------------------------------------------- groups */

export const groupsConfig: EntityConfig<Group & { attributes: Record<string, unknown> }> = {
  title: 'Vehicle Groups',
  singular: 'group',
  subtitle: 'Regional fleets, business units and sub-fleets.',
  endpoint: '/api/groups',
  queryKey: 'groups',
  searchText: (g) => g.name,
  columns: [
    { label: 'Name', render: (g) => g.name },
    { label: 'Parent group', render: (g) => (g.groupId ? groupName.get(g.groupId) : 'Top level') },
  ],
  fields: [
    { path: 'name', label: 'Name', required: true },
    { path: 'groupId', label: 'Parent group', type: 'select', options: groupOptions, optionsKey: 'groups' },
  ],
};

export function GroupsPage() {
  void groupName.load();
  return <EntityPage config={groupsConfig} />;
}

/* ------------------------------------------------------------------ drivers */

export const driversConfig: EntityConfig<Driver> = {
  title: 'Registered Drivers',
  singular: 'driver',
  subtitle: 'Authorised operators, RFID / iButton keys, licence and KYC.',
  endpoint: '/api/drivers',
  queryKey: 'drivers',
  searchText: (d) => `${d.name} ${d.uniqueId} ${JSON.stringify(d.attributes)}`,
  columns: [
    { label: 'Name', render: (d) => d.name },
    { label: 'Driver ID / RFID', render: (d) => d.uniqueId },
    { label: 'Driving licence', render: (d) => attr(d, 'licenceNo') },
    { label: 'Licence expiry', render: (d) => date(d.attributes?.licenceExpiry as string | undefined) },
    { label: 'Aadhar', render: (d) => attr(d, 'aadhar') },
    { label: 'Phone', render: (d) => attr(d, 'phone') },
  ],
  fields: [
    { path: 'name', label: 'Driver name', required: true },
    { path: 'uniqueId', label: 'Driver ID / RFID / iButton', required: true, helper: 'Must match what the tracker reports' },
    { path: 'attributes.licenceNo', label: 'Driving licence number' },
    { path: 'attributes.licenceExpiry', label: 'Licence expiry', type: 'date' },
    { path: 'attributes.aadhar', label: 'Aadhar number', helper: '12-digit UIDAI number' },
    { path: 'attributes.phone', label: 'Contact number' },
  ],
};

/* -------------------------------------------------------------------- users */

interface UserRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  administrator: boolean;
  readonly: boolean;
  disabled: boolean;
  deviceLimit: number;
  userLimit: number;
  expirationTime: string | null;
  attributes: Record<string, unknown>;
}

const ERP_ROLES: Option[] = [
  ['fleet_supervisor', 'Fleet supervisor'],
  ['workshop_manager', 'Workshop manager'],
  ['technician', 'Technician / lead mechanic'],
  ['storekeeper', 'Storekeeper / inventory'],
  ['accountant', 'Accountant / finance'],
  ['driver', 'Driver'],
  ['viewer', 'Viewer (read only)'],
].map(([value, label]) => ({ value, label }));

const roles = (() => {
  let cache = new Map<number, string>();
  return {
    async load() {
      try {
        cache = new Map((await http<{ userId: number; role: string }[]>('/erp/users/roles')).map((r) => [r.userId, r.role]));
      } catch {
        // keep the previous cache; the page still works without role labels
      }
      return cache;
    },
    label: (id: number) => ERP_ROLES.find((r) => r.value === cache.get(id))?.label ?? 'Viewer (read only)',
  };
})();

export const usersConfig: EntityConfig<UserRow> = {
  title: 'Users',
  singular: 'user',
  subtitle: 'Accounts, ERP roles, limits and access.',
  endpoint: '/api/users',
  queryKey: 'users',
  defaults: { deviceLimit: -1, userLimit: 0, erpRole: 'viewer' } as Partial<UserRow>,
  searchText: (u) => `${u.name} ${u.email} ${u.phone ?? ''}`,
  columns: [
    { label: 'Name', render: (u) => u.name },
    { label: 'Email', render: (u) => u.email },
    { label: 'Phone', render: (u) => u.phone ?? '—' },
    { label: 'Role', render: (u) => (u.administrator ? 'Administrator' : roles.label(u.id)) },
    { label: 'Status', render: (u) => <Chip size="small" label={u.disabled ? 'Disabled' : 'Active'} color={u.disabled ? 'default' : 'success'} />, csv: (u) => (u.disabled ? 'Disabled' : 'Active') },
    { label: 'Expires', render: (u) => date(u.expirationTime) },
  ],
  fields: [
    { section: 'Account', path: 'name', label: 'Name', required: true },
    { section: 'Account', path: 'email', label: 'Email', required: true },
    { section: 'Account', path: 'password', label: 'Password', type: 'password', required: true, createOnly: true },
    { section: 'Account', path: 'phone', label: 'Phone' },
    { section: 'Access', path: 'erpRole', label: 'ERP role', type: 'select', options: ERP_ROLES, required: true, visible: (v) => !v.administrator },
    { section: 'Access', path: 'administrator', label: 'Administrator', type: 'switch' },
    { section: 'Access', path: 'readonly', label: 'Read only', type: 'switch' },
    { section: 'Access', path: 'disabled', label: 'Disabled', type: 'switch' },
    { section: 'Limits', path: 'expirationTime', label: 'Account expiry', type: 'date' },
    { section: 'Limits', path: 'deviceLimit', label: 'Device limit', type: 'number', helper: '-1 for unlimited' },
    { section: 'Limits', path: 'userLimit', label: 'User limit', type: 'number', helper: 'How many sub-users this account may create' },
  ],
  omitOnSave: ['erpRole'],
  loadExtra: async (u) => ({ erpRole: (await roles.load()).get(u.id) ?? 'viewer' }),
  afterSave: async (saved, values) => {
    if (!saved.administrator && values.erpRole) {
      await http(`/erp/users/${saved.id}/role`, { method: 'PUT', body: JSON.stringify({ role: values.erpRole }) });
    }
    await roles.load();
  },
};

export function UsersPage() {
  void roles.load();
  return <EntityPage config={usersConfig} />;
}

/* -------------------------------------------------------------- alert rules */

interface NotificationRow {
  id: number;
  type: string;
  description: string | null;
  always: boolean;
  notificators: string;
  calendarId: number;
  commandId: number;
  attributes: Record<string, unknown>;
}

export const ALARMS = [
  'general', 'sos', 'vibration', 'movement', 'lowspeed', 'overspeed', 'fallDown', 'lowPower', 'lowBattery', 'fault',
  'powerOff', 'powerOn', 'door', 'lock', 'unlock', 'geofence', 'geofenceEnter', 'geofenceExit', 'gpsAntennaCut',
  'accident', 'tow', 'idle', 'highRpm', 'hardAcceleration', 'hardBraking', 'hardCornering', 'laneChange',
  'fatigueDriving', 'powerCut', 'powerRestored', 'jamming', 'temperature', 'parking', 'bonnet', 'footBrake',
  'fuelLeak', 'tampering', 'removing',
].map((a) => ({ value: a, label: humanize(a) }));

export const alertRulesConfig: EntityConfig<NotificationRow> = {
  title: 'Alert Notification Rules',
  singular: 'alert rule',
  subtitle: 'Which events raise alerts, for which vehicles, and how they are delivered.',
  endpoint: '/api/notifications',
  queryKey: 'alert-rules',
  defaults: { always: true, notificators: 'web', attributes: {} } as Partial<NotificationRow>,
  searchText: (n) => `${eventLabel(n.type)} ${n.description ?? ''} ${n.notificators}`,
  columns: [
    { label: 'Event', render: (n) => eventLabel(n.type) },
    { label: 'Description', render: (n) => n.description ?? '—' },
    { label: 'Alarms', render: (n) => (n.type === 'alarm' ? String(n.attributes?.alarms ?? 'All') : '—') },
    { label: 'Channels', render: (n) => n.notificators.split(',').map((c) => <Chip key={c} size="small" label={c.toUpperCase()} sx={{ mr: 0.5 }} />), csv: (n) => n.notificators },
    { label: 'Scope', render: (n) => (n.always ? 'All vehicles' : 'Linked vehicles') },
  ],
  fields: [
    { path: 'type', label: 'Event type', type: 'select', required: true, options: typeOptions('/api/notifications/types', eventLabel), optionsKey: 'notification-types' },
    { path: 'attributes.alarms', label: 'Alarms', type: 'multiselect', joined: true, options: ALARMS, visible: (v) => v.type === 'alarm', fullWidth: true },
    { path: 'notificators', label: 'Channels', type: 'multiselect', joined: true, required: true, options: typeOptions('/api/notifications/notificators', (t) => t.toUpperCase()), optionsKey: 'notificators' },
    { path: 'description', label: 'Description' },
    { path: 'calendarId', label: 'Active schedule (calendar)', type: 'select', options: calendarOptions, optionsKey: 'calendars' },
    { path: 'always', label: 'Apply to all vehicles (24/7 monitored)', type: 'switch' },
    { path: 'attributes.priority', label: 'High priority', type: 'switch' },
  ],
};

/* -------------------------------------------------------------- maintenance */

interface MaintenanceRow {
  id: number;
  name: string;
  type: string;
  start: number;
  period: number;
  attributes: Record<string, unknown>;
}

const MAINT_TYPES: Record<string, { label: string; unit: string; scale: number }> = {
  totalDistance: { label: 'Distance (GPS)', unit: 'km', scale: 1000 },
  odometer: { label: 'Odometer', unit: 'km', scale: 1000 },
  hours: { label: 'Engine hours', unit: 'h', scale: 3_600_000 },
};
const maintFmt = (type: string, v: number) => {
  const t = MAINT_TYPES[type];
  return t ? `${(v / t.scale).toLocaleString('en-IN')} ${t.unit}` : String(v);
};

export const maintenanceConfig: EntityConfig<MaintenanceRow> = {
  title: 'Maintenance Rules',
  singular: 'maintenance rule',
  subtitle: 'Service intervals by distance or engine hours; Traccar raises "maintenance required" alerts.',
  endpoint: '/api/maintenance',
  queryKey: 'maintenance',
  defaults: { type: 'totalDistance', attributes: {} } as Partial<MaintenanceRow>,
  columns: [
    { label: 'Name', render: (m) => m.name },
    { label: 'Measured by', render: (m) => MAINT_TYPES[m.type]?.label ?? m.type },
    { label: 'Starts at', render: (m) => maintFmt(m.type, m.start) },
    { label: 'Every', render: (m) => maintFmt(m.type, m.period) },
  ],
  fields: [
    { path: 'name', label: 'Name', required: true, fullWidth: true },
    { path: 'type', label: 'Measured by', type: 'select', required: true, options: Object.entries(MAINT_TYPES).map(([value, t]) => ({ value, label: `${t.label} (${t.unit})` })) },
    { path: 'startView', label: 'Starts at', type: 'number', required: true },
    { path: 'periodView', label: 'Repeat every', type: 'number', required: true },
  ],
  loadExtra: async (m) => ({ startView: m.start / (MAINT_TYPES[m.type]?.scale ?? 1), periodView: m.period / (MAINT_TYPES[m.type]?.scale ?? 1) }),
  beforeSave: (v) => {
    const scale = MAINT_TYPES[String(v.type)]?.scale ?? 1;
    return { ...v, start: Number(v.startView) * scale, period: Number(v.periodView) * scale };
  },
  omitOnSave: ['startView', 'periodView'],
};

/* ---------------------------------------------------------------- calendars */

interface CalendarRow {
  id: number;
  name: string;
  data: string;
  attributes: Record<string, unknown>;
}

const icalStamp = (iso: string) => dayjs(iso).utc().format('YYYYMMDDTHHmmss[Z]');

/** Builds the base64 iCalendar Traccar stores for a simple (optionally repeating) window. */
export function buildIcal(from: string, to: string, repeat: string) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FleetOne//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}`,
    `DTSTART:${icalStamp(from)}`,
    `DTEND:${icalStamp(to)}`,
    ...(repeat ? [`RRULE:FREQ=${repeat}`] : []),
    'SUMMARY:Schedule',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return btoa(lines.join('\r\n'));
}

export function parseIcal(data: string) {
  try {
    const text = atob(data);
    const get = (k: string) => text.match(new RegExp(`${k}[^:]*:(\\S+)`))?.[1];
    const parse = (v?: string) => (v ? dayjs(v.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, '$1-$2-$3T$4:$5:$6Z')).toISOString() : '');
    return { from: parse(get('DTSTART')), to: parse(get('DTEND')), repeat: get('RRULE')?.replace('FREQ=', '').split(';')[0] ?? '' };
  } catch {
    return { from: '', to: '', repeat: '' };
  }
}

const REPEAT: Option[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'DAILY', label: 'Every day' },
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'MONTHLY', label: 'Every month' },
];

export const calendarsConfig: EntityConfig<CalendarRow> = {
  title: 'Automation Calendars',
  singular: 'calendar',
  subtitle: 'Time windows that limit when alerts, geofences and shifts apply.',
  endpoint: '/api/calendars',
  queryKey: 'calendars',
  columns: [
    { label: 'Name', render: (c) => c.name },
    { label: 'Window', render: (c) => { const p = parseIcal(c.data); return p.from ? `${dayjs(p.from).format('D MMM HH:mm')} → ${dayjs(p.to).format('D MMM HH:mm')}` : '—'; } },
    { label: 'Repeats', render: (c) => REPEAT.find((r) => r.value === parseIcal(c.data).repeat)?.label ?? 'Custom' },
  ],
  fields: [
    { path: 'name', label: 'Name', required: true, fullWidth: true },
    { path: 'ical.from', label: 'From', type: 'datetime', required: true },
    { path: 'ical.to', label: 'To', type: 'datetime', required: true },
    { path: 'ical.repeat', label: 'Repeat', type: 'select', options: REPEAT },
  ],
  loadExtra: async (c) => ({ ical: parseIcal(c.data) }),
  beforeSave: (v) => {
    const ical = v.ical as { from: string; to: string; repeat: string };
    return { ...v, data: buildIcal(ical.from, ical.to, ical.repeat ?? '') };
  },
  omitOnSave: ['ical'],
};

/* ----------------------------------------------------- computed attributes */

interface AttributeRow {
  id: number;
  description: string;
  attribute: string;
  expression: string;
  type: string;
  priority: number;
}

export const attributesConfig: EntityConfig<AttributeRow> = {
  title: 'Computed Attributes',
  singular: 'computed attribute',
  subtitle: 'JEXL expressions that derive values from incoming tracker data (e.g. fuel litres from a sensor).',
  endpoint: '/api/attributes/computed',
  queryKey: 'computed-attributes',
  defaults: { type: 'number', priority: 0 },
  columns: [
    { label: 'Description', render: (a) => a.description },
    { label: 'Attribute', render: (a) => a.attribute },
    { label: 'Expression', render: (a) => <code>{a.expression}</code>, csv: (a) => a.expression },
    { label: 'Type', render: (a) => a.type },
  ],
  fields: [
    { path: 'description', label: 'Description', required: true },
    { path: 'attribute', label: 'Attribute name', required: true, helper: 'e.g. fuel, ignition, temp1' },
    { path: 'expression', label: 'Expression (JEXL)', type: 'textarea', required: true, helper: 'e.g. adc1 * 0.25' },
    { path: 'type', label: 'Result type', type: 'select', required: true, options: ['string', 'number', 'boolean'].map((t) => ({ value: t, label: t })) },
    { path: 'priority', label: 'Priority', type: 'number' },
  ],
};

/* ----------------------------------------------------------- saved commands */

interface CommandRow {
  id: number;
  description: string;
  type: string;
  textChannel: boolean;
  deviceId: number;
  attributes: Record<string, unknown>;
}

export const commandsConfig: EntityConfig<CommandRow> = {
  title: 'Saved Commands',
  singular: 'saved command',
  subtitle: 'Reusable over-the-air commands: immobilise, resume, poll position, reboot…',
  endpoint: '/api/commands',
  queryKey: 'commands',
  defaults: { type: 'custom', textChannel: false, attributes: {} } as Partial<CommandRow>,
  columns: [
    { label: 'Description', render: (c) => c.description },
    { label: 'Type', render: (c) => humanize(c.type) },
    { label: 'Data', render: (c) => String(c.attributes?.data ?? '—') },
    { label: 'Via SMS', render: (c) => (c.textChannel ? 'Yes' : 'No') },
  ],
  fields: [
    { path: 'description', label: 'Description', required: true, fullWidth: true },
    { path: 'type', label: 'Command type', type: 'select', required: true, options: typeOptions('/api/commands/types'), optionsKey: 'command-types' },
    { path: 'attributes.data', label: 'Command text', visible: (v) => v.type === 'custom', fullWidth: true },
    { path: 'textChannel', label: 'Send via SMS', type: 'switch' },
  ],
};

/* -------------------------------------------------------- scheduled reports */

interface ScheduledReportRow {
  id: number;
  type: string;
  description: string;
  calendarId: number;
  attributes: Record<string, unknown>;
}

const REPORT_TYPES: Option[] = [
  ['summary', 'Summary'], ['trips', 'Trips'], ['stops', 'Stops'], ['events', 'Events'], ['route', 'Positions'], ['combined', 'Combined'],
].map(([value, label]) => ({ value, label }));
const deviceOptions = async (): Promise<Option[]> => (await http<Device[]>('/api/devices')).map((d) => ({ value: d.id, label: d.name }));

export const scheduledReportsConfig: EntityConfig<ScheduledReportRow> = {
  title: 'Scheduled Reports',
  singular: 'scheduled report',
  subtitle: 'Reports emailed automatically on the schedule of a calendar (needs SMTP).',
  endpoint: '/api/reports',
  queryKey: 'scheduled-reports',
  defaults: { type: 'summary', attributes: {} } as Partial<ScheduledReportRow>,
  columns: [
    { label: 'Report', render: (r) => REPORT_TYPES.find((t) => t.value === r.type)?.label ?? r.type },
    { label: 'Description', render: (r) => r.description },
    { label: 'Schedule', render: (r) => `Calendar #${r.calendarId}` },
  ],
  fields: [
    { path: 'type', label: 'Report', type: 'select', required: true, options: REPORT_TYPES },
    { path: 'description', label: 'Description', required: true },
    { path: 'calendarId', label: 'Schedule (calendar)', type: 'select', required: true, options: calendarOptions, optionsKey: 'calendars', helper: 'Create a repeating calendar first' },
    { path: 'deviceIds', label: 'Vehicles', type: 'multiselect', options: deviceOptions, optionsKey: 'device-options', createOnly: true, fullWidth: true },
  ],
  omitOnSave: ['deviceIds'],
  afterSave: async (saved, values, isNew) => {
    if (!isNew) return;
    for (const deviceId of (values.deviceIds as number[] | undefined) ?? []) {
      await http('/api/permissions', { method: 'POST', body: JSON.stringify({ reportId: saved.id, deviceId }) });
    }
  },
};
