import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { complianceDocs } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { crudController, validationError } from '../erp/crud';
import { text } from '../erp/zod-helpers';
import { TraccarService } from '../traccar/traccar.service';

export const VEHICLE_DOCS = {
  rc: 'Registration certificate (RC)',
  insurance: 'Commercial insurance',
  fitness: 'Fitness certificate',
  puc: 'Pollution (PUC)',
  national_permit: 'National permit (Form 48)',
  state_permit: 'State / goods permit',
  road_tax: 'Road tax',
  speed_governor: 'Speed governor certificate',
  ais140: 'AIS-140 VLTD certificate',
} as const;
export const DRIVER_DOCS = {
  driving_licence: 'Driving licence',
  hazmat: 'Hazardous goods endorsement',
  medical: 'Medical fitness',
  police_verification: 'Police verification',
} as const;
/** A vehicle without a valid one of these must not run. */
export const MANDATORY_VEHICLE_DOCS = ['rc', 'insurance', 'fitness', 'puc', 'national_permit'] as const;
export const EXPIRING_DAYS = 30;

const day = z.preprocess((v) => (v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullish()).transform((v) => v ?? null);

export type ComplianceDoc = typeof complianceDocs.$inferSelect;
export type DocStatus = 'valid' | 'expiring' | 'expired';

/** Days left until expiry (negative when overdue); null for documents that never expire. */
export function daysLeft(expiry: string | null, today = new Date()) {
  if (!expiry) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = expiry.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000);
}

export function docStatus(expiry: string | null, today = new Date()): DocStatus {
  const left = daysLeft(expiry, today);
  if (left === null) return 'valid';
  return left < 0 ? 'expired' : left <= EXPIRING_DAYS ? 'expiring' : 'valid';
}

export const withStatus = (d: ComplianceDoc, today = new Date()) => ({ ...d, daysLeft: daysLeft(d.expiryDate, today), status: docStatus(d.expiryDate, today) });

const schema = z.object({
  subjectType: z.enum(['vehicle', 'driver']),
  subject: z.string().trim().min(2, 'is required').max(100),
  docType: z.enum(['other', ...Object.keys(VEHICLE_DOCS), ...Object.keys(DRIVER_DOCS)] as [string, ...string[]]),
  docNo: text(80),
  authority: text(120),
  issueDate: day,
  expiryDate: day,
  description: text(500),
});

export const ComplianceDocsController = crudController({
  path: 'compliance/documents',
  docType: 'compliance_doc',
  table: complianceDocs,
  searchColumns: [complianceDocs.subject, complianceDocs.docNo, complianceDocs.authority, complianceDocs.description],
  filters: { subjectType: complianceDocs.subjectType, subject: complianceDocs.subject, docType: complianceDocs.docType },
  orderBy: [asc(complianceDocs.expiryDate)],
  where: (q) => (q.all === '1' ? undefined : isNull(complianceDocs.supersededById)),
  schema,
  beforeCreate: (input) => {
    const subjectType = input.subjectType as string;
    const docType = input.docType as string;
    if (subjectType === 'vehicle' && docType in DRIVER_DOCS) throw new BadRequestException(`${docType.replace(/_/g, ' ')} is a driver document`);
    if (subjectType === 'driver' && docType in VEHICLE_DOCS) throw new BadRequestException(`${docType.replace(/_/g, ' ')} is a vehicle document`);
    if (input.issueDate && input.expiryDate && String(input.expiryDate) < String(input.issueDate)) throw new BadRequestException('expiryDate: is before the issue date');
    return { ...input, subject: subjectType === 'vehicle' ? String(input.subject).toUpperCase() : input.subject };
  },
});

/** What a Vahan / ULIP aggregator returns for a vehicle, normalised. Dates are YYYY-MM-DD. */
export interface VahanRecord {
  rcNo?: string;
  registeredAt?: string;
  rto?: string;
  owner?: string;
  insurer?: string;
  insurancePolicyNo?: string;
  insuranceUpto?: string;
  fitnessUpto?: string;
  pucNo?: string;
  pucUpto?: string;
  permitNo?: string;
  permitType?: string;
  permitUpto?: string;
  taxUpto?: string;
}

const renewBody = z.object({ docNo: text(80), authority: text(120), issueDate: day, expiryDate: day, description: text(500) });

@Injectable()
export class ComplianceService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly traccar: TraccarService,
  ) {}

  async current(where?: SQL) {
    const rows = await this.db.select().from(complianceDocs).where(and(isNull(complianceDocs.supersededById), where)).orderBy(complianceDocs.expiryDate);
    return rows.map((r) => withStatus(r));
  }

  /** Replaces a document with its renewal; the old one stays as history. */
  async renew(user: AuthUser, id: number, raw: unknown) {
    const parsed = renewBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const [old] = await this.db.select().from(complianceDocs).where(eq(complianceDocs.id, id));
    if (!old) throw new NotFoundException();
    if (old.supersededById) throw new BadRequestException('This document was already renewed');
    const d = parsed.data;
    if (d.expiryDate && old.expiryDate && d.expiryDate <= old.expiryDate) throw new BadRequestException('expiryDate: the renewal must expire after the current document');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(complianceDocs)
        .values({
          subjectType: old.subjectType,
          subject: old.subject,
          docType: old.docType,
          docNo: d.docNo ?? old.docNo,
          authority: d.authority ?? old.authority,
          issueDate: d.issueDate,
          expiryDate: d.expiryDate,
          description: d.description ?? old.description,
          createdBy: user.id,
        })
        .returning();
      await tx.update(complianceDocs).set({ supersededById: row.id, updatedAt: new Date() }).where(eq(complianceDocs.id, id));
      await this.audit.log(user, 'renew', 'compliance_doc', id, { renewalId: row.id, expiryDate: d.expiryDate });
      return withStatus(row);
    });
  }

  async history(id: number) {
    const [doc] = await this.db.select().from(complianceDocs).where(eq(complianceDocs.id, id));
    if (!doc) throw new NotFoundException();
    const all = await this.db
      .select()
      .from(complianceDocs)
      .where(and(eq(complianceDocs.subject, doc.subject), eq(complianceDocs.docType, doc.docType)))
      .orderBy(desc(complianceDocs.expiryDate));
    return all.map((r) => withStatus(r));
  }

  async summary(user: AuthUser) {
    const docs = await this.current();
    const vehicles = (await this.traccar.get<{ name: string }[]>(user.cookie, '/devices')).map((d) => d.name.toUpperCase());
    const subjects = new Set([...vehicles, ...docs.filter((d) => d.subjectType === 'vehicle').map((d) => d.subject)]);
    const vehicleStatus = [...subjects].sort().map((v) => {
      const mine = docs.filter((d) => d.subjectType === 'vehicle' && d.subject === v);
      const missing = MANDATORY_VEHICLE_DOCS.filter((t) => !mine.some((d) => d.docType === t));
      const expired = mine.filter((d) => d.status === 'expired' && (MANDATORY_VEHICLE_DOCS as readonly string[]).includes(d.docType)).map((d) => d.docType);
      const expiring = mine.filter((d) => d.status === 'expiring').map((d) => d.docType);
      return { vehicleNo: v, documents: mine.length, missing, expired, expiring, grounded: expired.length > 0, compliant: !missing.length && !expired.length };
    });
    const byType = new Map<string, { docType: string; total: number; valid: number; expiring: number; expired: number }>();
    for (const d of docs) {
      const t = byType.get(d.docType) ?? { docType: d.docType, total: 0, valid: 0, expiring: 0, expired: 0 };
      t.total++;
      t[d.status]++;
      byType.set(d.docType, t);
    }
    const valid = docs.filter((d) => d.status !== 'expired').length;
    return {
      monitored: docs.length,
      complianceIndex: docs.length ? Math.round((valid / docs.length) * 1000) / 10 : null,
      expiring: docs.filter((d) => d.status === 'expiring').length,
      expired: docs.filter((d) => d.status === 'expired').length,
      vehiclesGrounded: vehicleStatus.filter((v) => v.grounded).length,
      vehiclesCompliant: vehicleStatus.filter((v) => v.compliant).length,
      vehiclesMissingDocs: vehicleStatus.filter((v) => v.missing.length).length,
      byType: [...byType.values()],
      vehicles: vehicleStatus,
      nextExpiring: docs.filter((d) => d.status !== 'valid').slice(0, 20),
    };
  }

  /** Calls the configured Vahan / ULIP aggregator. Kept separate so tests can replace it. */
  async fetchVahan(vehicleNo: string): Promise<VahanRecord> {
    if (!config.vahanApiUrl) {
      throw new BadRequestException('The Vahan / ULIP aggregator is not configured. Set VAHAN_API_URL and VAHAN_API_KEY on the API server.');
    }
    const res = await fetch(`${config.vahanApiUrl.replace(/\/$/, '')}/vehicles/${encodeURIComponent(vehicleNo)}`, {
      headers: { Accept: 'application/json', ...(config.vahanApiKey ? { Authorization: `Bearer ${config.vahanApiKey}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) throw new NotFoundException(`Vahan has no record for ${vehicleNo}`);
    if (!res.ok) throw new BadRequestException(`Vahan lookup failed (HTTP ${res.status})`);
    return (await res.json()) as VahanRecord;
  }

  /** Pulls RC, insurance, fitness, PUC, permit and tax from Vahan; adds or renews documents that changed. */
  async syncVahan(user: AuthUser, vehicleNoRaw: string) {
    const vehicleNo = String(vehicleNoRaw ?? '').trim().toUpperCase();
    if (vehicleNo.length < 4) throw new BadRequestException('vehicleNo is required');
    const v = await this.fetchVahan(vehicleNo);
    const wanted: { docType: string; docNo?: string; authority?: string; issueDate?: string; expiryDate?: string }[] = [
      { docType: 'rc', docNo: v.rcNo ?? vehicleNo, authority: v.rto, issueDate: v.registeredAt },
      { docType: 'insurance', docNo: v.insurancePolicyNo, authority: v.insurer, expiryDate: v.insuranceUpto },
      { docType: 'fitness', authority: v.rto, expiryDate: v.fitnessUpto },
      { docType: 'puc', docNo: v.pucNo, expiryDate: v.pucUpto },
      { docType: v.permitType?.toLowerCase().includes('national') ? 'national_permit' : 'state_permit', docNo: v.permitNo, expiryDate: v.permitUpto },
      { docType: 'road_tax', authority: v.rto, expiryDate: v.taxUpto },
    ].filter((w) => w.expiryDate || (w.docType === 'rc' && v.rcNo));
    const result: { docType: string; action: 'added' | 'renewed' | 'unchanged' }[] = [];
    for (const w of wanted) {
      const [existing] = await this.db
        .select()
        .from(complianceDocs)
        .where(and(eq(complianceDocs.subject, vehicleNo), eq(complianceDocs.docType, w.docType), isNull(complianceDocs.supersededById)));
      const values = { subjectType: 'vehicle', subject: vehicleNo, docType: w.docType, docNo: w.docNo ?? null, authority: w.authority ?? null, issueDate: w.issueDate ?? null, expiryDate: w.expiryDate ?? null, source: 'vahan', verifiedAt: new Date(), createdBy: user.id };
      if (existing && (existing.expiryDate ?? '') === (w.expiryDate ?? '')) {
        await this.db.update(complianceDocs).set({ verifiedAt: new Date(), updatedAt: new Date() }).where(eq(complianceDocs.id, existing.id));
        result.push({ docType: w.docType, action: 'unchanged' });
      } else if (existing) {
        await this.db.transaction(async (tx) => {
          const [row] = await tx.insert(complianceDocs).values(values).returning();
          await tx.update(complianceDocs).set({ supersededById: row.id, updatedAt: new Date() }).where(eq(complianceDocs.id, existing.id));
        });
        result.push({ docType: w.docType, action: 'renewed' });
      } else {
        await this.db.insert(complianceDocs).values(values);
        result.push({ docType: w.docType, action: 'added' });
      }
    }
    await this.audit.log(user, 'vahan_sync', 'compliance_doc', null, { vehicleNo, result });
    return { vehicleNo, owner: v.owner ?? null, result };
  }
}

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly svc: ComplianceService,
    private readonly access: AccessService,
  ) {}

  @Get('meta')
  meta() {
    return { vehicleDocs: VEHICLE_DOCS, driverDocs: DRIVER_DOCS, mandatory: MANDATORY_VEHICLE_DOCS, expiringDays: EXPIRING_DAYS, vahanConfigured: !!config.vahanApiUrl };
  }

  @Get('status')
  async status(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('subjectType') subjectType?: string) {
    await this.access.require(u, 'compliance_doc', 'view');
    const rows = await this.svc.current(subjectType ? eq(complianceDocs.subjectType, subjectType) : undefined);
    return status ? rows.filter((r) => r.status === status) : rows;
  }

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'compliance_doc', 'view');
    return this.svc.summary(u);
  }

  @Get('documents/:id/history')
  async history(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'compliance_doc', 'view');
    return this.svc.history(id);
  }

  @Post('documents/:id/renew')
  async renew(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'compliance_doc', 'edit');
    return this.svc.renew(u, id, body);
  }

  @Post('vahan-sync')
  async vahan(@CurrentUser() u: AuthUser, @Body() body: { vehicleNo?: string }) {
    await this.access.require(u, 'compliance_doc', 'create');
    return this.svc.syncVahan(u, String(body?.vehicleNo ?? ''));
  }
}
