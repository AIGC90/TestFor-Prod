import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { deviceLicenses, type SubscriptionLine, subscriptionInvoices } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { crudController, validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { TraccarService } from '../traccar/traccar.service';
import { today } from './invoices';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const GST_RATE = 18;
export const PLANS = {
  standard: { name: 'Standard telematics', pricePerYear: 1800, features: ['Live tracking & replay', 'Reports & alerts', 'Geofences', 'Mobile app'] },
  ais140: { name: 'AIS-140 certified', pricePerYear: 2400, features: ['Everything in Standard', 'Panic button & VAHAN backend', 'State emergency response (ERSS) feed'] },
  dashcam: { name: 'AI dashcam + telematics', pricePerYear: 9600, features: ['Everything in AIS-140', 'Live front & driver cameras', 'ADAS / DMS alerts', 'Cloud recordings'] },
} as const;
type Plan = keyof typeof PLANS;
const day = z.preprocess((v) => (v === '' || v === null ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional());

/** Same day N months later (clamped to month end). */
export function addMonths(d: string, months: number) {
  const [y, m, dd] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(dd, last))).toISOString().slice(0, 10);
}
export const licenceDaysLeft = (expiresOn: string, on = today()) => Math.round((new Date(`${expiresOn}T00:00:00Z`).getTime() - new Date(`${on}T00:00:00Z`).getTime()) / DAY);
export const licenceState = (l: { status: string; expiresOn: string }, on = today()) => {
  if (l.status !== 'active') return l.status;
  const left = licenceDaysLeft(l.expiresOn, on);
  return left < 0 ? 'expired' : left <= 30 ? 'expiring' : 'active';
};

export const DeviceLicensesController = crudController({
  path: 'subscriptions/licenses',
  docType: 'subscription',
  table: deviceLicenses,
  searchColumns: [deviceLicenses.licNo, deviceLicenses.vehicleNo, deviceLicenses.imei, deviceLicenses.simNo],
  filters: { plan: deviceLicenses.plan, status: deviceLicenses.status, vehicleNo: deviceLicenses.vehicleNo },
  orderBy: [asc(deviceLicenses.expiresOn)],
  numbering: { prefix: 'LIC', column: 'licNo' },
  schema: z.object({
    vehicleNo: z.string().trim().toUpperCase().min(4).max(20),
    deviceId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    imei: z.string().trim().regex(/^\d{15}$/, 'must be 15 digits'),
    simOperator: z.enum(['Airtel', 'Jio', 'Vi', 'BSNL', 'Other']).nullish().transform((v) => v ?? null),
    simNo: text(25),
    plan: z.enum(Object.keys(PLANS) as [Plan, ...Plan[]]),
    activatedOn: day,
    expiresOn: day,
    status: z.enum(['active', 'suspended', 'cancelled']).default('active'),
  }),
  beforeCreate: (input) => {
    const activatedOn = (input.activatedOn as string | undefined) ?? today();
    const expiresOn = (input.expiresOn as string | undefined) ?? addMonths(activatedOn, 12);
    if (expiresOn <= activatedOn) throw new BadRequestException('expiresOn: must be after activation');
    return { ...input, activatedOn, expiresOn };
  },
});

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly traccar: TraccarService,
  ) {}

  /** Extends licences by whole months from today or their current expiry, whichever is later, and bills them. */
  async renew(user: AuthUser, raw: unknown) {
    const p = z.object({ licenseIds: z.array(z.coerce.number().int().positive()).min(1).max(500), months: z.coerce.number().int().refine((m) => [1, 3, 6, 12, 24, 36].includes(m), 'months must be 1, 3, 6, 12, 24 or 36') }).safeParse(raw);
    if (!p.success) throw validationError(p.error);
    const list = await this.db.select().from(deviceLicenses).where(inArray(deviceLicenses.id, p.data.licenseIds));
    if (list.length !== new Set(p.data.licenseIds).size) throw new BadRequestException('licenseIds: a licence was not found');
    const cancelled = list.find((l) => l.status === 'cancelled');
    if (cancelled) throw new ConflictException(`${cancelled.licNo} is cancelled`);
    const t = today();
    const lines: SubscriptionLine[] = list.map((l) => {
      const fromDate = l.expiresOn > t ? l.expiresOn : t;
      return { licenseId: l.id, licNo: l.licNo, vehicleNo: l.vehicleNo, plan: l.plan, months: p.data.months, amount: r2((PLANS[l.plan as Plan].pricePerYear * p.data.months) / 12), from: fromDate, to: addMonths(fromDate, p.data.months) };
    });
    const net = r2(lines.reduce((s, l) => s + l.amount, 0));
    const gst = r2((net * GST_RATE) / 100);
    return this.db.transaction(async (tx) => {
      for (const l of lines) await tx.update(deviceLicenses).set({ expiresOn: l.to, status: 'active', updatedAt: new Date() }).where(eq(deviceLicenses.id, l.licenseId));
      const [inv] = await tx
        .insert(subscriptionInvoices)
        .values({ sinvNo: await this.numbering.next('SINV'), invoiceDate: t, description: `Renewal of ${lines.length} licence${lines.length > 1 ? 's' : ''} for ${p.data.months} month${p.data.months > 1 ? 's' : ''}`, lines, net, gst, total: r2(net + gst), createdBy: user.id })
        .returning();
      await this.audit.log(user, 'renew', 'subscription', inv.id, { licences: lines.length, months: p.data.months, total: inv.total });
      return inv;
    });
  }

  async pay(user: AuthUser, id: number, raw: unknown) {
    const p = z.object({ paymentMethod: z.enum(['upi', 'card', 'netbanking', 'neft', 'cheque']), paymentRef: text(80) }).safeParse(raw);
    if (!p.success) throw validationError(p.error);
    const [inv] = await this.db.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.id, id));
    if (!inv) throw new NotFoundException();
    if (inv.status === 'paid') throw new ConflictException('Already paid');
    const [row] = await this.db.update(subscriptionInvoices).set({ ...p.data, status: 'paid', paidAt: new Date(), updatedAt: new Date() }).where(eq(subscriptionInvoices.id, id)).returning();
    await this.audit.log(user, 'pay', 'subscription', id, p.data);
    return row;
  }

  /** Creates a licence for every Traccar device that has none (IMEI = the device identifier). */
  async importDevices(user: AuthUser, plan: string) {
    if (!(plan in PLANS)) throw new BadRequestException('plan is not valid');
    const [devices, existing] = await Promise.all([
      this.traccar.get<{ id: number; name: string; uniqueId: string; phone?: string | null }[]>(user.cookie, '/devices'),
      this.db.select({ imei: deviceLicenses.imei, deviceId: deviceLicenses.deviceId }).from(deviceLicenses),
    ]);
    const have = new Set(existing.map((e) => e.imei));
    const haveDevice = new Set(existing.map((e) => e.deviceId));
    const skipped: { vehicleNo: string; reason: string }[] = [];
    let created = 0;
    for (const d of devices) {
      if (have.has(d.uniqueId) || haveDevice.has(d.id)) continue;
      if (!/^\d{15}$/.test(d.uniqueId)) {
        skipped.push({ vehicleNo: d.name, reason: `identifier ${d.uniqueId} is not a 15-digit IMEI` });
        continue;
      }
      await this.db.insert(deviceLicenses).values({ licNo: await this.numbering.next('LIC'), vehicleNo: d.name.toUpperCase(), deviceId: d.id, imei: d.uniqueId, simNo: d.phone ?? null, plan, activatedOn: today(), expiresOn: addMonths(today(), 12), createdBy: user.id });
      created++;
    }
    await this.audit.log(user, 'import', 'subscription', null, { created, skipped: skipped.length });
    return { created, skipped };
  }

  async summary() {
    const [list, invoicesList] = await Promise.all([this.db.select().from(deviceLicenses), this.db.select().from(subscriptionInvoices)]);
    const live = list.filter((l) => l.status !== 'cancelled');
    const state = live.map((l) => licenceState(l));
    const unpaid = invoicesList.filter((i) => i.status === 'unpaid');
    return {
      subscribed: live.length,
      active: state.filter((s) => s === 'active').length,
      expiring30: state.filter((s) => s === 'expiring').length,
      expired: state.filter((s) => s === 'expired').length,
      sims: new Set(live.map((l) => l.simNo).filter(Boolean)).size,
      byPlan: Object.entries(PLANS).map(([key, p]) => ({ plan: key, name: p.name, count: live.filter((l) => l.plan === key).length })),
      unpaidInvoices: unpaid.length,
      unpaidAmount: r2(unpaid.reduce((s, i) => s + i.total, 0)),
      annualValue: r2(live.reduce((s, l) => s + PLANS[l.plan as Plan].pricePerYear, 0)),
      plans: PLANS,
      gstRate: GST_RATE,
    };
  }
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly svc: SubscriptionsService,
    private readonly access: AccessService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'subscription', 'view');
    return this.svc.summary();
  }

  @Get('status')
  async status(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'subscription', 'view');
    const list = await this.db.select().from(deviceLicenses).orderBy(asc(deviceLicenses.expiresOn));
    return list.map((l) => ({ ...l, state: licenceState(l), daysLeft: licenceDaysLeft(l.expiresOn) }));
  }

  @Post('renew')
  async renew(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.access.require(u, 'subscription', 'edit');
    return this.svc.renew(u, body);
  }

  @Post('import-devices')
  async importDevices(@CurrentUser() u: AuthUser, @Body() body: { plan?: string }) {
    await this.access.require(u, 'subscription', 'create');
    return this.svc.importDevices(u, String(body?.plan ?? 'standard'));
  }

  @Get('invoices')
  async invoices(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'subscription', 'view');
    return this.db.select().from(subscriptionInvoices).orderBy(desc(subscriptionInvoices.invoiceDate), desc(subscriptionInvoices.id));
  }

  @Post('invoices/:id/pay')
  async pay(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'subscription', 'edit');
    return this.svc.pay(u, id, body);
  }
}

/** Live video comes from a JT/T 1078 (or vendor) media server; we only build the stream URLs. */
@Controller('dashcam')
export class DashcamController {
  constructor(private readonly traccar: TraccarService) {}

  @Get('config')
  config() {
    return { configured: !!config.dashcamStreamUrl, channels: [{ id: 1, name: 'Front camera' }, { id: 2, name: 'Driver camera' }] };
  }

  @Get('stream')
  async stream(@CurrentUser() u: AuthUser, @Query('deviceId') deviceId: string, @Query('channel') channel = '1') {
    if (!config.dashcamStreamUrl) throw new BadRequestException('No dashcam media server is configured. Set DASHCAM_STREAM_URL on the API server.');
    if (!['1', '2'].includes(channel)) throw new BadRequestException('channel must be 1 or 2');
    // fetching through the user's Traccar session means they only get devices they can see
    const [device] = await this.traccar.get<{ id: number; uniqueId: string; name: string }[]>(u.cookie, `/devices?id=${Number(deviceId)}`);
    if (!device) throw new NotFoundException('Device not found');
    const url = config.dashcamStreamUrl.replace('{deviceId}', String(device.id)).replace('{uniqueId}', encodeURIComponent(device.uniqueId)).replace('{channel}', channel);
    return { url, vehicleNo: device.name, channel: Number(channel) };
  }
}
