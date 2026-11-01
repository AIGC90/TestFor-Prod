import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Logger, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { driverAssignments, driverProfiles, emergencyContacts, incidents, insuranceClaims, sosIncidents } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { crudController, validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { requiredText, text } from '../erp/zod-helpers';

const vehicle = z.string().trim().toUpperCase().min(4, 'enter the vehicle number').max(20);
const optNum = z.coerce.number().min(0).nullish().transform((v) => (v === undefined ? null : v));
const optCoord = z.coerce.number().min(-180).max(180).nullish().transform((v) => (v === undefined ? null : v));
const dateOrNow = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.date().optional());

/** Traccar alarm → SOS trigger, label and severity. Other alarms are left to the notification centre. */
export const SOS_ALARMS: Record<string, { label: string; severity: 'critical' | 'high' | 'medium' }> = {
  sos: { label: 'Panic button', severity: 'critical' },
  accident: { label: 'Crash / severe impact', severity: 'critical' },
  fallDown: { label: 'Rollover / fall', severity: 'critical' },
  tampering: { label: 'Device tampering', severity: 'high' },
  powerCut: { label: 'Power cut', severity: 'high' },
  jamming: { label: 'GPS / GSM jamming', severity: 'medium' },
  manual: { label: 'Reported by phone', severity: 'high' },
};
/** A repeat of the same alarm on the same vehicle within this window joins the open incident. */
const DEDUP_MS = 15 * 60_000;

/* ------------------------------------------------------------ incidents */

export const IncidentsController = crudController({
  path: 'safety/incidents',
  docType: 'incident',
  table: incidents,
  searchColumns: [incidents.incNo, incidents.vehicleNo, incidents.driverName, incidents.narrative, incidents.location],
  filters: { status: incidents.status, vehicleNo: incidents.vehicleNo, severity: incidents.severity, type: incidents.type },
  orderBy: [desc(incidents.occurredAt), desc(incidents.id)],
  numbering: { prefix: 'INC', column: 'incNo' },
  schema: z.object({
    vehicleNo: vehicle,
    driverName: text(100),
    occurredAt: dateOrNow,
    type: z.enum(['accident', 'breakdown', 'theft', 'fire', 'cargo_damage', 'injury', 'other']),
    narrative: requiredText(4000),
    location: text(300),
    latitude: optCoord,
    longitude: optCoord,
    severity: z.enum(['major', 'minor']).default('minor'),
    rsaProvider: text(120),
    rsaStatus: z.enum(['none', 'requested', 'dispatched', 'completed']).default('none'),
    repairCost: optNum,
    sosId: z.coerce.number().int().positive().nullish(),
    status: z.enum(['open', 'investigating', 'closed']).default('open'),
  }),
  beforeCreate: (input) => ({ ...input, occurredAt: input.occurredAt ?? new Date() }),
  beforeUpdate: (input, existing) => {
    if (input.status === 'closed' && existing.status !== 'closed') return { ...input, closedAt: new Date() };
    if (input.status && input.status !== 'closed') return { ...input, closedAt: null };
    return input;
  },
  canDelete: async (row, ctx) => {
    const [claim] = await ctx.db.select({ id: insuranceClaims.id }).from(insuranceClaims).where(eq(insuranceClaims.incidentId, row.id as number));
    return claim ? 'An insurance claim refers to this incident' : null;
  },
});

export const ClaimsController = crudController({
  path: 'safety/claims',
  docType: 'incident',
  table: insuranceClaims,
  searchColumns: [insuranceClaims.clmNo, insuranceClaims.vehicleNo, insuranceClaims.insurer, insuranceClaims.policyNo, insuranceClaims.insurerClaimNo, insuranceClaims.surveyor],
  filters: { status: insuranceClaims.status, vehicleNo: insuranceClaims.vehicleNo, incidentId: insuranceClaims.incidentId },
  orderBy: [desc(insuranceClaims.filedAt), desc(insuranceClaims.id)],
  numbering: { prefix: 'CLM', column: 'clmNo' },
  schema: z.object({
    incidentId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    vehicleNo: vehicle,
    insurer: requiredText(120),
    policyNo: text(80),
    insurerClaimNo: text(80),
    surveyor: text(120),
    estimatedDamage: z.coerce.number().min(0).default(0),
    approvedPayout: optNum,
    settledAmount: optNum,
    status: z.enum(['filed', 'survey', 'approved', 'settled', 'rejected']).default('filed'),
    remarks: text(1000),
  }),
  beforeCreate: async (input, ctx) => {
    if (input.incidentId) {
      const [inc] = await ctx.db.select().from(incidents).where(eq(incidents.id, input.incidentId as number));
      if (!inc) throw new BadRequestException('incidentId: incident not found');
      if (inc.vehicleNo !== input.vehicleNo) throw new BadRequestException(`vehicleNo: the incident is for ${inc.vehicleNo}`);
    }
    return input;
  },
  beforeUpdate: (input, existing) => {
    const status = (input.status ?? existing.status) as string;
    const payout = (input.approvedPayout ?? existing.approvedPayout) as number | null;
    const settled = (input.settledAmount ?? existing.settledAmount) as number | null;
    if (status === 'approved' && payout === null) throw new BadRequestException('approvedPayout: enter the amount the insurer approved');
    if (status === 'settled' && settled === null) throw new BadRequestException('settledAmount: enter the amount received');
    if (payout !== null && settled !== null && settled > payout) throw new BadRequestException('settledAmount: is more than the approved payout');
    return status === 'settled' && existing.status !== 'settled' ? { ...input, settledAt: new Date() } : input;
  },
});

export const EmergencyContactsController = crudController({
  path: 'safety/contacts',
  docType: 'sos',
  table: emergencyContacts,
  searchColumns: [emergencyContacts.name, emergencyContacts.phone],
  orderBy: [asc(emergencyContacts.sort), asc(emergencyContacts.id)],
  schema: z.object({
    name: requiredText(100),
    phone: z.string().trim().regex(/^\+?[0-9 -]{3,20}$/, 'is not a phone number'),
    kind: z.enum(['police', 'highway', 'ambulance', 'fire', 'control_room', 'other']).default('other'),
    sort: z.coerce.number().int().default(0),
  }),
});

export const DEFAULT_CONTACTS = [
  { name: 'Unified emergency (police)', phone: '911', kind: 'police', sort: 1 },
  { name: 'Red Crescent ambulance', phone: '997', kind: 'ambulance', sort: 2 },
  { name: 'Civil Defence (fire)', phone: '998', kind: 'fire', sort: 3 },
  { name: 'Traffic police / road accidents', phone: '993', kind: 'highway', sort: 4 },
  { name: 'Najm (accident reporting)', phone: '920000560', kind: 'highway', sort: 5 },
  { name: 'Company control room', phone: '+966 11 000 0000', kind: 'control_room', sort: 6 },
];

/* ------------------------------------------------------------------ SOS */

interface AlarmEvent {
  event?: { id?: number; type?: string; deviceId?: number; eventTime?: string; attributes?: Record<string, unknown> };
  position?: { latitude?: number; longitude?: number; speed?: number; address?: string; attributes?: Record<string, unknown> };
  device?: { name?: string; phone?: string; contact?: string };
}

const manualSos = z.object({
  vehicleNo: vehicle,
  trigger: z.enum(Object.keys(SOS_ALARMS) as [string, ...string[]]).default('manual'),
  driverName: text(100),
  driverPhone: text(30),
  address: text(300),
  latitude: optCoord,
  longitude: optCoord,
});

@Injectable()
export class SafetyService {
  private readonly log = new Logger('Safety');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** Current driver of a vehicle, from Driver Management assignments. */
  async currentDriver(vehicleNo: string) {
    const [row] = await this.db
      .select({ name: driverProfiles.name, phone: driverProfiles.phone })
      .from(driverAssignments)
      .innerJoin(driverProfiles, eq(driverProfiles.id, driverAssignments.driverId))
      .where(and(eq(driverAssignments.vehicleNo, vehicleNo), isNull(driverAssignments.toAt)));
    return row ?? null;
  }

  /** Turns a forwarded Traccar alarm into an SOS incident (once per alarm burst). */
  async onTraccarEvent(body: AlarmEvent) {
    const e = body.event ?? {};
    const alarm = String(e.attributes?.alarm ?? body.position?.attributes?.alarm ?? '');
    if (e.type !== 'alarm' || !SOS_ALARMS[alarm]) return null;
    const vehicleNo = (body.device?.name ?? `DEVICE-${e.deviceId}`).toUpperCase();
    const since = new Date(Date.now() - DEDUP_MS);
    const [open] = await this.db
      .select()
      .from(sosIncidents)
      .where(and(eq(sosIncidents.vehicleNo, vehicleNo), eq(sosIncidents.trigger, alarm), inArray(sosIncidents.status, ['active', 'responding']), gte(sosIncidents.raisedAt, since)));
    if (open) return open;
    const p = body.position ?? {};
    const driver = await this.currentDriver(vehicleNo);
    const ign = p.attributes?.ignition;
    try {
      const [row] = await this.db
        .insert(sosIncidents)
        .values({
          sosNo: await this.numbering.next('SOS'),
          deviceId: e.deviceId ?? null,
          vehicleNo,
          driverName: driver?.name ?? null,
          driverPhone: driver?.phone ?? body.device?.phone ?? null,
          trigger: alarm,
          severity: SOS_ALARMS[alarm].severity,
          speedKmh: typeof p.speed === 'number' ? Math.round(p.speed * 1.852 * 10) / 10 : null,
          ignition: typeof ign === 'boolean' ? (ign ? 'on' : 'off') : null,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          address: p.address ?? null,
          raisedAt: e.eventTime ? new Date(e.eventTime) : new Date(),
          traccarEventId: e.id ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) this.log.warn(`${row.sosNo}: ${SOS_ALARMS[alarm].label} on ${vehicleNo}`);
      return row ?? null;
    } catch (err) {
      this.log.error(`Could not record SOS for ${vehicleNo}: ${(err as Error).message}`);
      return null;
    }
  }

  async raise(user: AuthUser, raw: unknown) {
    const parsed = manualSos.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const driver = await this.currentDriver(d.vehicleNo);
    const [row] = await this.db
      .insert(sosIncidents)
      .values({
        sosNo: await this.numbering.next('SOS'),
        vehicleNo: d.vehicleNo,
        trigger: d.trigger,
        severity: SOS_ALARMS[d.trigger].severity,
        driverName: d.driverName ?? driver?.name ?? null,
        driverPhone: d.driverPhone ?? driver?.phone ?? null,
        address: d.address,
        latitude: d.latitude,
        longitude: d.longitude,
        createdBy: user.id,
      })
      .returning();
    await this.audit.log(user, 'raise', 'sos', row.id, { vehicleNo: d.vehicleNo, trigger: d.trigger });
    return row;
  }

  private async sos(id: number) {
    const [s] = await this.db.select().from(sosIncidents).where(eq(sosIncidents.id, id));
    if (!s) throw new NotFoundException();
    return s;
  }

  async respond(user: AuthUser, id: number, body: { responder?: string }) {
    const s = await this.sos(id);
    if (s.status !== 'active') throw new ConflictException(`${s.sosNo} is already ${s.status}`);
    const [row] = await this.db
      .update(sosIncidents)
      .set({ status: 'responding', respondedAt: new Date(), respondedBy: user.id, responder: String(body?.responder ?? '').trim() || user.name, updatedAt: new Date() })
      .where(eq(sosIncidents.id, id))
      .returning();
    await this.audit.log(user, 'respond', 'sos', id);
    return row;
  }

  /** Closes an SOS; a real emergency can be escalated into the incident register in the same step. */
  async resolve(user: AuthUser, id: number, raw: unknown) {
    const parsed = z
      .object({ resolution: requiredText(2000), falseAlarm: z.coerce.boolean().default(false), createIncident: z.coerce.boolean().default(false), incidentType: z.enum(['accident', 'breakdown', 'theft', 'fire', 'cargo_damage', 'injury', 'other']).default('accident') })
      .safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const s = await this.sos(id);
    if (s.status === 'resolved') throw new ConflictException(`${s.sosNo} is already resolved`);
    if (d.falseAlarm && d.createIncident) throw new BadRequestException('A false alarm cannot become an incident');
    return this.db.transaction(async (tx) => {
      let incidentId: number | null = null;
      if (d.createIncident) {
        const [inc] = await tx
          .insert(incidents)
          .values({
            incNo: await this.numbering.next('INC'),
            vehicleNo: s.vehicleNo,
            driverName: s.driverName,
            occurredAt: s.raisedAt,
            type: d.incidentType,
            narrative: `${SOS_ALARMS[s.trigger]?.label ?? s.trigger} (${s.sosNo}). ${d.resolution}`,
            location: s.address,
            latitude: s.latitude,
            longitude: s.longitude,
            severity: s.severity === 'critical' ? 'major' : 'minor',
            sosId: s.id,
            createdBy: user.id,
          })
          .returning();
        incidentId = inc.id;
      }
      const [row] = await tx
        .update(sosIncidents)
        .set({ status: 'resolved', resolvedAt: new Date(), respondedAt: s.respondedAt ?? new Date(), resolution: d.resolution, falseAlarm: d.falseAlarm ? 1 : 0, incidentId, updatedAt: new Date() })
        .where(eq(sosIncidents.id, id))
        .returning();
      await this.audit.log(user, 'resolve', 'sos', id, { incidentId, falseAlarm: d.falseAlarm });
      return row;
    });
  }

  async sosSummary() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const recent = await this.db.select().from(sosIncidents).where(gte(sosIncidents.raisedAt, since));
    const open = await this.db.select().from(sosIncidents).where(inArray(sosIncidents.status, ['active', 'responding']));
    const responded = recent.filter((s) => s.respondedAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      active: open.filter((s) => s.status === 'active').length,
      responding: open.filter((s) => s.status === 'responding').length,
      resolvedToday: recent.filter((s) => s.resolvedAt && s.resolvedAt >= today).length,
      avgResponseMinutes: responded.length ? Math.round(responded.reduce((t, s) => t + (s.respondedAt!.getTime() - s.raisedAt.getTime()), 0) / responded.length / 6000) / 10 : null,
      last30Days: recent.length,
      falseAlarms: recent.filter((s) => s.falseAlarm).length,
    };
  }

  async safetySummary() {
    const [all, claims] = await Promise.all([this.db.select().from(incidents).orderBy(desc(incidents.occurredAt)), this.db.select().from(insuranceClaims)]);
    const accidents = all.filter((i) => i.type === 'accident' || i.severity === 'major');
    const lastAccident = accidents[0]?.occurredAt ?? null;
    const yearAgo = new Date(Date.now() - 365 * 86_400_000);
    const lastYear = all.filter((i) => i.occurredAt >= yearAgo);
    const major = lastYear.filter((i) => i.severity === 'major').length;
    // simple 5-point rating: start at 5, lose 0.5 per major and 0.1 per minor incident in the last year
    const rating = Math.max(1, Math.round((5 - major * 0.5 - (lastYear.length - major) * 0.1) * 10) / 10);
    const byType = new Map<string, number>();
    lastYear.forEach((i) => byType.set(i.type, (byType.get(i.type) ?? 0) + 1));
    return {
      incidentFreeDays: lastAccident ? Math.floor((Date.now() - lastAccident.getTime()) / 86_400_000) : null,
      logged: all.length,
      open: all.filter((i) => i.status !== 'closed').length,
      resolved: all.filter((i) => i.status === 'closed').length,
      claimsOpen: claims.filter((c) => !['settled', 'rejected'].includes(c.status)).length,
      claimed: claims.reduce((s, c) => s + c.estimatedDamage, 0),
      recovered: claims.reduce((s, c) => s + (c.settledAmount ?? 0), 0),
      safetyRating: rating,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
    };
  }
}

@Controller('safety')
export class SafetyController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly svc: SafetyService,
    private readonly access: AccessService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'incident', 'view');
    return this.svc.safetySummary();
  }

  @Get('sos')
  async sosList(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    await this.access.require(u, 'sos', 'view');
    return this.db
      .select()
      .from(sosIncidents)
      .where(status ? eq(sosIncidents.status, status) : undefined)
      .orderBy(desc(sosIncidents.raisedAt))
      .limit(1000);
  }

  @Get('sos/summary')
  async sosSummary(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'sos', 'view');
    return { ...(await this.svc.sosSummary()), triggers: SOS_ALARMS };
  }

  @Post('sos')
  async raise(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.access.require(u, 'sos', 'create');
    return this.svc.raise(u, body);
  }

  @Post('sos/:id/respond')
  async respond(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { responder?: string }) {
    await this.access.require(u, 'sos', 'edit');
    return this.svc.respond(u, id, body);
  }

  @Post('sos/:id/resolve')
  async resolve(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'sos', 'edit');
    if (body && (body as { createIncident?: boolean }).createIncident) await this.access.require(u, 'incident', 'create');
    return this.svc.resolve(u, id, body);
  }

  @Post('contacts/defaults')
  async defaults(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'sos', 'create');
    const existing = await this.db.select().from(emergencyContacts);
    const missing = DEFAULT_CONTACTS.filter((c) => !existing.some((e) => e.phone === c.phone));
    if (missing.length) await this.db.insert(emergencyContacts).values(missing.map((c) => ({ ...c, createdBy: u.id })));
    return this.db.select().from(emergencyContacts).orderBy(asc(emergencyContacts.sort));
  }
}
