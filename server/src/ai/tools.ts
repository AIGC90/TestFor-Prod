import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth';
import type { Db } from '../db/db.module';
import { items, sosIncidents, stockBalances, stores, trips } from '../db/schema';
import type { AccessService } from '../erp/access.service';
import type { ApprovalsService } from '../erp/approvals.service';
import type { DocType } from '../erp/doctypes';
import type { AnalyticsService } from '../finance/analytics';
import type { InvoicesService } from '../finance/invoices';
import type { ComplianceService } from '../people/compliance';
import type { DriversService } from '../people/drivers';
import type { SafetyService } from '../people/safety';
import type { TraccarService } from '../traccar/traccar.service';
import type { TyresService } from '../tyres/tyres.service';
import { SERVICE_TYPES } from '../workshop/docs';
import type { WorkshopService } from '../workshop/workshop.service';
import { toolJson } from './mask';

const DAY = 86_400_000;
const kmh = (knots: number) => Math.round(knots * 1.852);

export interface ToolDeps {
  db: Db;
  traccar: TraccarService;
  access: AccessService;
  approvals: ApprovalsService;
  workshop: WorkshopService;
  tyres: TyresService;
  compliance: ComplianceService;
  safety: SafetyService;
  drivers: DriversService;
  analytics: AnalyticsService;
  invoices: InvoicesService;
  /** Records a proposed action and routes it to the Pending Inbox. */
  propose: (user: AuthUser, kind: ActionKind, params: Record<string, unknown>, summary: string, reason: string | null) => Promise<{ actNo: string; status: string }>;
}

/** What the copilot may propose. Nothing here touches the vehicle itself: engine immobilise/resume and other device commands are never exposed. */
export const ACTION_KINDS = {
  create_job_card: { label: 'Open a job card', docType: 'job_card' },
  job_card_from_pm: { label: 'Open a job card for a due PM task', docType: 'job_card' },
  assign_driver: { label: 'Assign a driver to a vehicle', docType: 'payroll' },
  create_field_task: { label: 'Assign a field task', docType: 'field_staff' },
  log_incident: { label: 'Log a safety incident', docType: 'incident' },
} as const satisfies Record<string, { label: string; docType: DocType }>;
export type ActionKind = keyof typeof ACTION_KINDS;

export const actionSchemas = {
  create_job_card: z.object({
    vehicleNo: z.string().min(4).describe('Registration number, e.g. MH12AB1234'),
    serviceType: z.enum(SERVICE_TYPES as [string, ...string[]]),
    problem: z.string().min(3).describe('What needs doing, in the workshop’s words'),
    priority: z.enum(['normal', 'high']).default('normal'),
  }),
  job_card_from_pm: z.object({ pmScheduleId: z.number().int().positive().describe('id from pm_due') }),
  assign_driver: z.object({ driverId: z.number().int().positive().describe('driverId from drivers_overview'), vehicleNo: z.string().min(4) }),
  create_field_task: z.object({
    staffId: z.number().int().positive(),
    kind: z.enum(['installation', 'service', 'collection', 'sales_visit', 'other']),
    title: z.string().min(3),
    address: z.string().optional(),
    dueAt: z.string().describe('ISO date-time'),
  }),
  log_incident: z.object({
    vehicleNo: z.string().min(4),
    type: z.enum(['accident', 'breakdown', 'theft', 'fire', 'cargo_damage', 'injury', 'other']),
    severity: z.enum(['major', 'minor']),
    narrative: z.string().min(10),
    location: z.string().optional(),
  }),
};

/** Wraps a tool body: checks the role may view the data, masks personal identifiers, and turns errors into text the model can act on. */
function guarded<T>(deps: ToolDeps, user: AuthUser, docType: DocType | null, fn: (input: T) => Promise<unknown>) {
  return async (input: T) => {
    try {
      if (docType && !(await deps.access.can(user, docType, 'view'))) return `Not permitted: the ${user.role.replace('_', ' ')} role cannot view ${docType.replace(/_/g, ' ')}. Tell the user you cannot see this data.`;
      return toolJson(await fn(input));
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  };
}

export function buildTools(deps: ToolDeps, user: AuthUser, toolsUsed: string[]) {
  const t = <S extends z.ZodType>(name: string, description: string, inputSchema: S, docType: DocType | null, fn: (input: z.infer<S>) => Promise<unknown>) =>
    betaZodTool({
      name,
      description,
      inputSchema,
      run: async (input) => {
        toolsUsed.push(name);
        return guarded(deps, user, docType, fn)(input);
      },
    });

  const devices = () => deps.traccar.get<{ id: number; name: string; status: string; lastUpdate: string | null; model: string | null }[]>(user.cookie, '/devices');

  return [
    t(
      'fleet_status',
      'Live status of vehicles from GPS: moving, idle (ignition on, stopped), stopped, offline; speed, position, address and last update. Use for "where is", "how many are moving", "which are offline".',
      z.object({ filter: z.enum(['all', 'moving', 'idle', 'stopped', 'offline']).default('all'), search: z.string().optional().describe('Part of a registration number') }),
      null,
      async ({ filter, search }) => {
        const [list, positions] = await Promise.all([devices(), deps.traccar.get<{ deviceId: number; latitude: number; longitude: number; speed: number; address: string | null; fixTime: string; attributes: Record<string, unknown> }[]>(user.cookie, '/positions')]);
        const pos = new Map(positions.map((p) => [p.deviceId, p]));
        const rows = list.map((d) => {
          const p = pos.get(d.id);
          const status = d.status !== 'online' || !p ? 'offline' : p.speed > 1.5 || p.attributes.motion ? 'moving' : p.attributes.ignition ? 'idle' : 'stopped';
          return { vehicle: d.name, status, speedKmh: p ? kmh(p.speed) : null, lat: p?.latitude ?? null, lon: p?.longitude ?? null, address: p?.address ?? null, lastUpdate: d.lastUpdate, odometerKm: p?.attributes.totalDistance ? Math.round(Number(p.attributes.totalDistance) / 1000) : null };
        });
        const counts = rows.reduce<Record<string, number>>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
        const filtered = rows.filter((r) => (filter === 'all' || r.status === filter) && (!search || r.vehicle.toUpperCase().replace(/\W/g, '').includes(search.toUpperCase().replace(/\W/g, ''))));
        return { total: rows.length, counts, vehicles: filtered.slice(0, 60), more: Math.max(0, filtered.length - 60) };
      },
    ),
    t(
      'recent_events',
      'GPS events in the last N hours: overspeed, geofence enter/exit, alarms (sos, harsh braking, fatigue, power cut, tampering), ignition, device offline. Returns counts by type and vehicle plus the latest events.',
      z.object({ hours: z.number().min(1).max(168).default(24), vehicle: z.string().optional(), types: z.array(z.string()).optional().describe('Traccar event types, e.g. deviceOverspeed, alarm, geofenceEnter') }),
      null,
      async ({ hours, vehicle, types }) => {
        const list = (await devices()).filter((d) => !vehicle || d.name.toUpperCase().replace(/\W/g, '').includes(vehicle.toUpperCase().replace(/\W/g, '')));
        if (!list.length) return { events: [], note: 'No matching vehicles' };
        const q = `${list.map((d) => `deviceId=${d.id}`).join('&')}&from=${new Date(Date.now() - hours * 3_600_000).toISOString()}&to=${new Date().toISOString()}${(types ?? []).map((x) => `&type=${encodeURIComponent(x)}`).join('')}`;
        const events = await deps.traccar.get<{ type: string; deviceId: number; eventTime: string; attributes: Record<string, unknown> }[]>(user.cookie, `/reports/events?${q}`);
        const name = new Map(list.map((d) => [d.id, d.name]));
        const byType: Record<string, number> = {};
        const byVehicle: Record<string, number> = {};
        for (const e of events) {
          const k = e.type === 'alarm' ? `alarm:${e.attributes.alarm}` : e.type;
          byType[k] = (byType[k] ?? 0) + 1;
          const v = name.get(e.deviceId) ?? String(e.deviceId);
          byVehicle[v] = (byVehicle[v] ?? 0) + 1;
        }
        const latest = events.slice(-40).reverse().map((e) => ({ vehicle: name.get(e.deviceId), type: e.type, alarm: e.attributes.alarm ?? null, at: e.eventTime, speedKmh: typeof e.attributes.speed === 'number' ? kmh(e.attributes.speed) : undefined }));
        return { hours, total: events.length, byType, topVehicles: Object.entries(byVehicle).sort((a, b) => b[1] - a[1]).slice(0, 10), latest };
      },
    ),
    t(
      'trips',
      'Trips with status, vehicle, driver, origin/destination, freight, planned arrival, POD. Filter by status (scheduled, in_transit, arrived, completed, cancelled) or vehicle.',
      z.object({ status: z.enum(['scheduled', 'in_transit', 'arrived', 'completed', 'cancelled']).optional(), vehicle: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }),
      'trip',
      async ({ status, vehicle, limit }) =>
        deps.db
          .select({ tripNo: trips.tripNo, status: trips.status, vehicleNo: trips.vehicleNo, driver: trips.driverName, origin: trips.origin, destination: trips.destination, freight: trips.freight, plannedArrival: trips.plannedArrival, startedAt: trips.startedAt, completedAt: trips.completedAt, pod: trips.podStatus, exception: trips.exceptionNote })
          .from(trips)
          .where(and(status ? eq(trips.status, status) : undefined, vehicle ? ilike(trips.vehicleNo, `%${vehicle}%`) : undefined))
          .orderBy(desc(trips.id))
          .limit(limit),
    ),
    t('workshop_overview', 'Workshop numbers: open/ageing job cards, PM overdue/due soon, gate passes out, money owed to garages, spend, costliest vehicles.', z.object({ days: z.number().int().min(1).max(365).default(30) }), 'job_card', async ({ days }) => deps.workshop.summary(user, days)),
    t(
      'pm_due',
      'Preventive maintenance schedules with km/days left from the GPS odometer; status overdue, due_soon, ok. Use before proposing a job card for PM.',
      z.object({ vehicle: z.string().optional(), onlyDue: z.boolean().default(true) }),
      'pm_schedule',
      async ({ vehicle, onlyDue }) => {
        const list = await deps.workshop.pmDue(user, vehicle);
        return (onlyDue ? list.filter((p) => p.status === 'overdue' || p.status === 'due_soon') : list).slice(0, 80);
      },
    ),
    t('tyre_health', 'Tyre overview: tread (NSD) health, alerts, low pressure, replacement forecast and cost per km.', z.object({}), 'tyre', async () => {
      const o = await deps.tyres.overview(user);
      return { ...o, spend: undefined };
    }),
    t('compliance_status', 'Statutory documents (RC, insurance, fitness, PUC, permits, licences): expired, expiring within 30 days, vehicles grounded or missing papers.', z.object({}), 'compliance_doc', async () => {
      const s = await deps.compliance.summary(user);
      return { ...s, vehicles: s.vehicles.filter((v) => !v.compliant).slice(0, 60) };
    }),
    t('safety_status', 'Active SOS alarms, SOS response stats, incidents and insurance claims summary.', z.object({}), 'sos', async () => ({
      sos: await deps.safety.sosSummary(),
      activeSos: await deps.db.select().from(sosIncidents).where(inArray(sosIncidents.status, ['active', 'responding'])).orderBy(desc(sosIncidents.raisedAt)).limit(20),
      incidents: (await deps.access.can(user, 'incident', 'view')) ? await deps.safety.safetySummary() : 'not permitted',
    })),
    t('drivers_overview', 'Drivers: on roll, on trucks, standby (with driverId), attendance today, trucks without a driver, driving hours vs the 9-hour limit, scores, licence issues, payroll.', z.object({}), 'payroll', async () => {
      const [o, roster] = await Promise.all([deps.drivers.overview(user), deps.drivers.roster(user)]);
      return { ...o, standby: roster.standby, vehiclesWithoutDriver: roster.vehiclesWithoutDriver.map((v) => v.vehicleNo) };
    }),
    t(
      'finance_kpis',
      'Revenue, expenses by category, profit, margin, revenue and cost per km, utilisation, fuel economy, lanes and per-vehicle P&L for the last N days (optionally one vehicle). Plus plain-language insights.',
      z.object({ days: z.number().int().min(1).max(400).default(30), vehicle: z.string().optional() }),
      'invoice',
      async ({ days, vehicle }) => {
        const a = await deps.analytics.compute(user, new Date(Date.now() - days * DAY), new Date(), vehicle);
        return { ...a, daily: undefined, vehicles: a.vehicles.slice(0, 40) };
      },
    ),
    t('receivables', 'Outstanding customer invoices: ageing buckets, overdue amounts, outstanding by customer.', z.object({}), 'invoice', async () => {
      const r = await deps.invoices.receivables();
      return { ...r, open: r.open.slice(0, 40) };
    }),
    t(
      'stock_lookup',
      'Stock on hand by item and store, with reorder levels. Search by item name or code.',
      z.object({ search: z.string().min(2) }),
      'item',
      async ({ search }) =>
        deps.db
          .select({ item: items.name, code: items.code, unit: items.unit, store: stores.name, qty: stockBalances.qty, value: stockBalances.value, reorderLevel: items.reorderLevel })
          .from(stockBalances)
          .innerJoin(items, eq(items.id, stockBalances.itemId))
          .innerJoin(stores, eq(stores.id, stockBalances.storeId))
          .where(or(ilike(items.name, `%${search}%`), ilike(items.code, `%${search}%`)))
          .limit(60),
    ),
    t('pending_approvals', 'Documents waiting for this user’s approval (fuel indents, job cards, repair bills, payroll, AI-proposed actions...).', z.object({}), null, async () => (await deps.approvals.inbox(user, { status: 'pending' })).slice(0, 50)),
    betaZodTool({
      name: 'propose_action',
      description:
        'Propose a change for a person to approve. Nothing happens until someone approves it in the Pending Inbox. Use only when the user asks for an action, and look up ids first (pm_due for pmScheduleId, drivers_overview for driverId). Kinds: ' +
        Object.entries(ACTION_KINDS)
          .map(([k, v]) => `${k} (${v.label})`)
          .join(', ') +
        '. Vehicle commands such as engine stop/resume cannot be proposed.',
      inputSchema: z.object({
        kind: z.enum(Object.keys(ACTION_KINDS) as [ActionKind, ...ActionKind[]]),
        params: z.record(z.string(), z.unknown()).describe('Fields for that kind: create_job_card {vehicleNo, serviceType, problem, priority}; job_card_from_pm {pmScheduleId}; assign_driver {driverId, vehicleNo}; create_field_task {staffId, kind, title, address, dueAt}; log_incident {vehicleNo, type, severity, narrative, location}'),
        summary: z.string().min(5).describe('One line the approver will read'),
        reason: z.string().optional().describe('Why, citing the data'),
      }),
      run: async ({ kind, params, summary, reason }) => {
        toolsUsed.push('propose_action');
        try {
          const parsed = actionSchemas[kind].safeParse(params);
          if (!parsed.success) return `Error: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
          if (!(await deps.access.can(user, ACTION_KINDS[kind].docType, 'view'))) return `Not permitted: the ${user.role} role cannot work with ${ACTION_KINDS[kind].docType.replace(/_/g, ' ')}.`;
          const res = await deps.propose(user, kind, parsed.data as Record<string, unknown>, summary, reason ?? null);
          return `Proposed as ${res.actNo}; status ${res.status}. It runs only after approval in the Pending Inbox. Tell the user this.`;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    }),
  ];
}
