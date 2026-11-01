import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { aiActions, aiConversations, aiReports, aiRuns, approvalRules, attachments, fastagAccounts, fieldStaff, fieldTasks, incidents, jobCards, sosIncidents } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import type { DocType } from '../erp/doctypes';
import { NumberingService } from '../erp/numbering.service';
import { AnalyticsService } from '../finance/analytics';
import { InvoicesService } from '../finance/invoices';
import { ComplianceService, DRIVER_DOCS, VEHICLE_DOCS } from '../people/compliance';
import { DriversService } from '../people/drivers';
import { SafetyService } from '../people/safety';
import { TraccarService } from '../traccar/traccar.service';
import { TyresService } from '../tyres/tyres.service';
import { WorkshopService } from '../workshop/workshop.service';
import { maskPii, toolJson } from './mask';
import { ACTION_KINDS, type ActionKind, actionSchemas, buildTools } from './tools';

/** Injection token for the Anthropic client; null when no API key is configured. Tests replace it with a fake. */
export const ANTHROPIC = Symbol('ANTHROPIC');
export const anthropicProvider = { provide: ANTHROPIC, useFactory: () => (config.aiEnabled ? new Anthropic() : null) };

/** Server-side refusal fallback: a declined request is retried on a suitable model inside the same call. */
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
const DAY = 86_400_000;

const COPILOT_SYSTEM = `You are FleetOne Copilot, the assistant inside a fleet-management and transport ERP operating in Saudi Arabia (live GPS tracking on Traccar, trips and lorry receipts, workshop, tyres, stock, compliance, drivers, finance).

How to work:
- Answer from the tools, not from memory. Call the tools you need (in parallel when they are independent), then answer.
- Be concise and specific: name vehicles, documents and amounts. Amounts are in Saudi riyals: write them as SAR 125,000. Times are KSA time (UTC+3).
- When data is missing or a tool says "Not permitted", say so plainly; never guess numbers.
- Personal identifiers in tool results are masked (XXXX). Keep them masked.
- You can only read data and propose actions. propose_action records a proposal that a person must approve in the Pending Inbox; say that clearly. You cannot send commands to vehicles (no engine stop/resume, no immobiliser) and must decline such requests.
- Format answers in short paragraphs or bullet lists; use a small table when comparing several vehicles.`;

const TRIAGE_SYSTEM = `You are the AI Ops analyst for a truck fleet in Saudi Arabia. You receive a snapshot of signals: GPS events, SOS alarms, tread-depth alerts, expiring or expired statutory documents, overdue maintenance, low FASTag balances and overdue receivables.
Group related signals into a short list of issues, most urgent first. Severity: critical = safety or legal risk now (active SOS, crash, expired insurance/fitness on a running truck, tread below 1.6 mm); high = needs action today; medium = this week; low = watch.
Each recommendedAction must be one concrete step for a fleet supervisor. Use vehicle numbers exactly as given. Do not invent signals that are not in the snapshot.`;

const BRIEFING_SYSTEM = `You write the daily morning briefing for the owner of a trucking company in Saudi Arabia. Use only the numbers in the data. Lead with what changed and what needs a decision today. Write amounts as SAR 125,000, keep each bullet to one line, and avoid jargon.`;

export const TriageSchema = z.object({
  headline: z.string().describe('One sentence on the fleet’s state'),
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      category: z.enum(['safety', 'compliance', 'maintenance', 'tyres', 'operations', 'finance', 'driver']),
      title: z.string(),
      detail: z.string(),
      vehicles: z.array(z.string()),
      recommendedAction: z.string(),
      link: z.string().describe('App path for the fix, e.g. /sos, /compliance, /pm-schedules, /nsd-alerts, /fastag, /revenue?tab=receivables, /trips'),
    }),
  ),
});
export type Triage = z.infer<typeof TriageSchema>;

export const BriefingSchema = z.object({
  title: z.string(),
  summary: z.string().describe('Two or three sentences'),
  sections: z.array(z.object({ heading: z.string(), bullets: z.array(z.string()) })),
  decisions: z.array(z.string()).describe('Decisions the owner should take today'),
});
export type Briefing = z.infer<typeof BriefingSchema>;

const ComplianceExtract = z.object({
  docType: z.enum(['other', ...Object.keys(VEHICLE_DOCS), ...Object.keys(DRIVER_DOCS)] as [string, ...string[]]),
  subjectType: z.enum(['vehicle', 'driver']),
  subject: z.string().nullable().describe('Vehicle registration number, or the holder’s name for a driver document'),
  docNo: z.string().nullable(),
  authority: z.string().nullable().describe('Issuing RTO, insurer or authority'),
  issueDate: z.string().nullable().describe('YYYY-MM-DD'),
  expiryDate: z.string().nullable().describe('YYYY-MM-DD; validity end'),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable().describe('Anything unclear or unreadable'),
});
const RepairBillExtract = z.object({
  garageName: z.string().nullable(),
  garageGstin: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  billDate: z.string().nullable().describe('YYYY-MM-DD'),
  vehicleNo: z.string().nullable(),
  taxable: z.number().nullable(),
  gstRate: z.number().nullable().describe('Percent, e.g. 18'),
  cgst: z.number().nullable(),
  sgst: z.number().nullable(),
  igst: z.number().nullable(),
  total: z.number().nullable(),
  lineItems: z.array(z.object({ description: z.string(), qty: z.number().nullable(), amount: z.number().nullable() })),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable(),
});
export const EXTRACTORS = {
  compliance: { schema: ComplianceExtract, prompt: 'Read this vehicle or driver document (vehicle registration / Istimara, insurance policy, periodic inspection / Fahas, permit or operating card, driving licence...). Map registration to rc and periodic inspection to fitness. Extract the fields. Use null for anything not visible; do not guess dates.' },
  repair_bill: { schema: RepairBillExtract, prompt: 'Read this garage / workshop repair invoice from Saudi Arabia. Extract the fields; amounts in Saudi riyals as plain numbers; put VAT in gstRate and igst if it is shown as one tax. Use null for anything not visible.' },
} as const;
type ExtractKind = keyof typeof EXTRACTORS;

interface Usage { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number }
type UsageLike = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined;
const addUsage = (u: Usage, x: UsageLike) => {
  u.requests++;
  u.input += x?.input_tokens ?? 0;
  u.output += x?.output_tokens ?? 0;
  u.cacheRead += x?.cache_read_input_tokens ?? 0;
  u.cacheWrite += x?.cache_creation_input_tokens ?? 0;
};
type Block = { type: string; text?: string };
const textOf = (content: Block[]) => content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();

@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AI');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(ANTHROPIC) private readonly client: Anthropic | null,
    private readonly traccar: TraccarService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly workshop: WorkshopService,
    private readonly tyres: TyresService,
    private readonly compliance: ComplianceService,
    private readonly safety: SafetyService,
    private readonly drivers: DriversService,
    private readonly analytics: AnalyticsService,
    private readonly invoices: InvoicesService,
  ) {}

  async onModuleInit() {
    // AI proposals always need a person: make sure an enabled rule exists (admins may change the approver role)
    await this.db.insert(approvalRules).values({ docType: 'ai_action', enabled: true, minAmount: 0, approverRole: 'fleet_supervisor' }).onConflictDoNothing();
    this.approvals.onDecision('ai_action', async (req, d, user) => {
      if (d === 'rejected') {
        await this.db.update(aiActions).set({ status: 'rejected' }).where(eq(aiActions.id, req.docId));
        return;
      }
      await this.execute(req.docId, user);
    });
    if (config.aiBriefingHour !== null && this.client && config.traccarServiceEmail) {
      this.timer = setInterval(() => void this.maybeBriefing().catch((e) => this.log.error(`Briefing failed: ${(e as Error).message}`)), 10 * 60_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  status() {
    return { enabled: !!this.client, model: config.aiModel, briefingHour: config.aiBriefingHour, actions: Object.fromEntries(Object.entries(ACTION_KINDS).map(([k, v]) => [k, v.label])) };
  }

  private requireClient(): Anthropic {
    if (!this.client) throw new ServiceUnavailableException('AI is not configured. Set the ANTHROPIC_API_KEY environment secret on the API server.');
    return this.client;
  }

  private async record(user: AuthUser | null, feature: string, started: number, usage: Usage, error?: string) {
    await this.db.insert(aiRuns).values({
      userId: user?.id ?? null,
      feature,
      model: config.aiModel,
      requests: usage.requests,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      ms: Date.now() - started,
      ok: !error,
      error: error ?? null,
    });
  }

  /* ----------------------------------------------------------- copilot */

  async conversations(user: AuthUser) {
    return this.db.select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt }).from(aiConversations).where(eq(aiConversations.userId, user.id)).orderBy(desc(aiConversations.updatedAt)).limit(50);
  }

  /** The conversation as the user sees it: their questions and the copilot's answers, without tool traffic. */
  async conversation(user: AuthUser, id: number) {
    const [c] = await this.db.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.id)));
    if (!c) throw new NotFoundException();
    const turns: { role: 'user' | 'assistant'; text: string }[] = [];
    for (const m of c.messages as Anthropic.Beta.BetaMessageParam[]) {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as Block[]);
      const text = textOf(blocks);
      if (!text || m.role === 'system') continue;
      turns.push({ role: m.role, text: m.role === 'user' ? text.replace(/^\[Context:[^\]]*\]\n/, '') : text });
    }
    const actions = await this.db.select().from(aiActions).where(eq(aiActions.conversationId, id)).orderBy(aiActions.id);
    return { id: c.id, title: c.title, turns, actions };
  }

  async chat(user: AuthUser, body: { conversationId?: number; message?: string }) {
    const message = String(body?.message ?? '').trim();
    if (!message) throw new BadRequestException('message is required');
    if (message.length > 4000) throw new BadRequestException('message is too long (4,000 characters at most)');
    const client = this.requireClient();
    let conv: typeof aiConversations.$inferSelect;
    if (body.conversationId) {
      const [c] = await this.db.select().from(aiConversations).where(and(eq(aiConversations.id, Number(body.conversationId)), eq(aiConversations.userId, user.id)));
      if (!c) throw new NotFoundException('Conversation not found');
      conv = c;
    } else {
      [conv] = await this.db.insert(aiConversations).values({ userId: user.id, title: message.slice(0, 80) }).returning();
    }
    const history = conv.messages as Anthropic.Beta.BetaMessageParam[];
    // per-turn context goes in the user message so the system prompt and tools stay cacheable
    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });
    const userTurn: Anthropic.Beta.BetaMessageParam = { role: 'user', content: `[Context: ${now} KSA time; user ${user.name}, role ${user.role}]\n${maskPii(message)}` };
    const toolsUsed: string[] = [];
    const proposed: string[] = [];
    const tools = buildTools(
      {
        db: this.db, traccar: this.traccar, access: this.access, approvals: this.approvals, workshop: this.workshop, tyres: this.tyres,
        compliance: this.compliance, safety: this.safety, drivers: this.drivers, analytics: this.analytics, invoices: this.invoices,
        propose: async (u, kind, params, summary, reason) => {
          const r = await this.propose(u, conv.id, kind, params, summary, reason);
          proposed.push(r.actNo);
          return r;
        },
      },
      user,
      toolsUsed,
    );
    const usage: Usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const started = Date.now();
    try {
      const runner = client.beta.messages.toolRunner({
        model: config.aiModel,
        max_tokens: 16000,
        max_iterations: 12,
        thread: false,
        ...FALLBACK,
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: COPILOT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: [...history, userTurn],
      });
      let last: Anthropic.Beta.BetaMessage | null = null;
      for await (const m of runner) {
        last = m;
        addUsage(usage, m.usage);
      }
      if (!last) throw new Error('The model returned nothing');
      const messages = [...runner.params.messages];
      if (messages.at(-1)?.role !== 'assistant') messages.push({ role: 'assistant', content: last.content });
      await this.db.update(aiConversations).set({ messages, updatedAt: new Date() }).where(eq(aiConversations.id, conv.id));
      await this.record(user, 'copilot', started, usage);
      const answer =
        last.stop_reason === 'refusal'
          ? 'I can’t help with that request.'
          : textOf(last.content as Block[]) || (last.stop_reason === 'max_tokens' ? 'The answer was too long; please narrow the question.' : 'Done.');
      return { conversationId: conv.id, answer, toolsUsed: [...new Set(toolsUsed)], proposedActions: proposed, stopReason: last.stop_reason };
    } catch (e) {
      await this.record(user, 'copilot', started, usage, (e as Error).message);
      throw this.apiError(e);
    }
  }

  private apiError(e: unknown) {
    if (e instanceof Anthropic.RateLimitError) return new ServiceUnavailableException('The AI service is busy; try again in a minute.');
    if (e instanceof Anthropic.AuthenticationError) return new ServiceUnavailableException('The AI API key was rejected; check ANTHROPIC_API_KEY.');
    if (e instanceof Anthropic.APIError) return new ServiceUnavailableException(`AI request failed (${e.status ?? 'network'}).`);
    return e instanceof Error ? e : new Error(String(e));
  }

  /* ------------------------------------------------------------ actions */

  async propose(user: AuthUser, conversationId: number | null, kind: ActionKind, params: Record<string, unknown>, summary: string, reason: string | null) {
    const [row] = await this.db
      .insert(aiActions)
      .values({ actNo: await this.numbering.next('AIA'), conversationId, kind, params, summary: maskPii(summary), reason: reason ? maskPii(reason) : null, requestedBy: user.id })
      .returning();
    const req = await this.approvals.submit(user, {
      docType: 'ai_action',
      docId: row.id,
      docNo: row.actNo,
      title: `AI proposal: ${ACTION_KINDS[kind].label}`,
      summary: [row.summary, row.reason].filter(Boolean).join(' — '),
      priority: kind === 'log_incident' ? 'high' : 'normal',
      meta: { link: '/ai-ops?tab=actions', kind, params },
    });
    if (!req) {
      await this.db.update(aiActions).set({ status: 'failed', error: 'The approval rule for AI actions is disabled' }).where(eq(aiActions.id, row.id));
      throw new ConflictException('AI actions need the "AI-proposed actions" approval rule to be enabled');
    }
    await this.audit.log(user, 'propose', 'ai_action', row.id, { kind });
    return { actNo: row.actNo, status: 'pending_approval' };
  }

  /** Runs an approved proposal as the approver, who must be allowed to create that kind of document. */
  async execute(id: number, approver: AuthUser) {
    const [a] = await this.db.select().from(aiActions).where(eq(aiActions.id, id));
    if (!a || a.status !== 'pending_approval') return;
    const kind = a.kind as ActionKind;
    try {
      const target = ACTION_KINDS[kind].docType as DocType;
      if (!(await this.access.can(approver, target, kind === 'assign_driver' ? 'edit' : 'create'))) throw new ForbiddenException(`${approver.name} cannot create ${target.replace(/_/g, ' ')}`);
      const p = actionSchemas[kind].parse(a.params) as Record<string, unknown>;
      let result: Record<string, unknown>;
      if (kind === 'create_job_card') {
        const [jc] = await this.db
          .insert(jobCards)
          .values({ jcNo: await this.numbering.next('JC'), vehicleNo: String(p.vehicleNo).toUpperCase(), serviceType: String(p.serviceType), problem: String(p.problem), priority: String(p.priority), jobType: 'own_workshop', createdBy: a.requestedBy })
          .returning();
        result = { jcNo: jc.jcNo, id: jc.id };
      } else if (kind === 'job_card_from_pm') {
        const jc = (await this.workshop.jobFromPm(approver, Number(p.pmScheduleId))) as { jcNo: string; id: number };
        result = { jcNo: jc.jcNo, id: jc.id };
      } else if (kind === 'assign_driver') {
        const r = await this.drivers.assign(approver, { driverId: p.driverId, vehicleNo: p.vehicleNo, remarks: `AI proposal ${a.actNo}` });
        result = { assignmentId: r.id, vehicleNo: r.vehicleNo };
      } else if (kind === 'create_field_task') {
        const [s] = await this.db.select().from(fieldStaff).where(eq(fieldStaff.id, Number(p.staffId)));
        if (!s || s.status !== 'active') throw new BadRequestException('Field staff member not found or inactive');
        const [t] = await this.db
          .insert(fieldTasks)
          .values({ ftNo: await this.numbering.next('FT'), staffId: s.id, kind: String(p.kind), title: String(p.title), address: (p.address as string) ?? null, city: s.city, dueAt: new Date(String(p.dueAt)), createdBy: a.requestedBy })
          .returning();
        result = { ftNo: t.ftNo, id: t.id };
      } else {
        const [inc] = await this.db
          .insert(incidents)
          .values({ incNo: await this.numbering.next('INC'), vehicleNo: String(p.vehicleNo).toUpperCase(), occurredAt: new Date(), type: String(p.type), severity: String(p.severity), narrative: String(p.narrative), location: (p.location as string) ?? null, createdBy: a.requestedBy })
          .returning();
        result = { incNo: inc.incNo, id: inc.id };
      }
      await this.db.update(aiActions).set({ status: 'executed', result, executedAt: new Date() }).where(eq(aiActions.id, id));
      await this.audit.log(approver, 'execute', 'ai_action', id, result);
    } catch (e) {
      await this.db.update(aiActions).set({ status: 'failed', error: (e as Error).message, executedAt: new Date() }).where(eq(aiActions.id, id));
      this.log.warn(`${a.actNo} failed: ${(e as Error).message}`);
    }
  }

  async actions(status?: string) {
    return this.db.select().from(aiActions).where(status ? eq(aiActions.status, status) : undefined).orderBy(desc(aiActions.id)).limit(200);
  }

  /* -------------------------------------------------------------- triage */

  /** Collects the signals AI Ops triages, each section only when the user may see it. */
  async signals(user: AuthUser, hours: number) {
    const can = (d: DocType) => this.access.can(user, d, 'view');
    const out: Record<string, unknown> = { window: `${hours} h`, at: new Date().toISOString() };
    const devices = await this.traccar.get<{ id: number; name: string; status: string; lastUpdate: string | null }[]>(user.cookie, '/devices');
    out.offlineVehicles = devices.filter((d) => d.status !== 'online').map((d) => ({ vehicle: d.name, lastUpdate: d.lastUpdate })).slice(0, 40);
    if (devices.length) {
      const q = `${devices.map((d) => `deviceId=${d.id}`).join('&')}&from=${new Date(Date.now() - hours * 3_600_000).toISOString()}&to=${new Date().toISOString()}&type=alarm&type=deviceOverspeed`;
      const events = await this.traccar.get<{ type: string; deviceId: number; eventTime: string; attributes: Record<string, unknown> }[]>(user.cookie, `/reports/events?${q}`);
      const name = new Map(devices.map((d) => [d.id, d.name]));
      const grouped = new Map<string, { vehicle: string; signal: string; count: number; last: string }>();
      for (const e of events) {
        const signal = e.type === 'alarm' ? `alarm:${e.attributes.alarm}` : 'overspeed';
        const vehicle = name.get(e.deviceId) ?? String(e.deviceId);
        const g = grouped.get(`${vehicle}|${signal}`) ?? { vehicle, signal, count: 0, last: e.eventTime };
        g.count++;
        g.last = e.eventTime > g.last ? e.eventTime : g.last;
        grouped.set(`${vehicle}|${signal}`, g);
      }
      out.gpsEvents = [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 60);
    }
    if (await can('sos')) out.activeSos = await this.db.select({ sosNo: sosIncidents.sosNo, vehicle: sosIncidents.vehicleNo, trigger: sosIncidents.trigger, severity: sosIncidents.severity, status: sosIncidents.status, raisedAt: sosIncidents.raisedAt, address: sosIncidents.address }).from(sosIncidents).where(inArray(sosIncidents.status, ['active', 'responding']));
    if (await can('tyre')) out.treadAlerts = (await this.tyres.nsdAlerts(user, 3)).map((t) => ({ vehicle: t.vehicleNo, position: t.position, serial: t.serial, nsdMm: t.lastNsd, severity: t.severity })).slice(0, 40);
    if (await can('compliance_doc')) {
      const s = await this.compliance.summary(user);
      out.compliance = { grounded: s.vehicles.filter((v) => v.grounded).map((v) => ({ vehicle: v.vehicleNo, expired: v.expired })), expiring: s.nextExpiring.map((d) => ({ subject: d.subject, docType: d.docType, expiryDate: d.expiryDate, daysLeft: d.daysLeft })), missingPapers: s.vehiclesMissingDocs };
    }
    if (await can('pm_schedule')) out.maintenance = (await this.workshop.pmDue(user)).filter((p) => p.status === 'overdue').map((p) => ({ vehicle: p.vehicleNo, task: p.task, kmLeft: p.kmLeft, daysLeft: p.daysLeft })).slice(0, 40);
    if (await can('fastag')) out.lowFastag = await this.db.select({ vehicle: fastagAccounts.vehicleNo, balance: fastagAccounts.balance }).from(fastagAccounts).where(eq(fastagAccounts.status, 'low_balance'));
    if (await can('invoice')) {
      const r = await this.invoices.receivables();
      out.receivables = { overdue: r.overdue, ageing: r.ageing, topOverdue: r.byCustomer.filter((c) => c.overdue > 0).slice(0, 5) };
    }
    return out;
  }

  async triage(user: AuthUser, hours = 24) {
    const client = this.requireClient();
    const snapshot = toolJson(await this.signals(user, hours), 120_000);
    const usage: Usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const started = Date.now();
    try {
      const res = await client.beta.messages.parse({
        model: config.aiModel,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium', format: zodOutputFormat(TriageSchema) },
        system: [{ type: 'text', text: TRIAGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Fleet signals snapshot:\n${snapshot}` }],
      });
      addUsage(usage, res.usage);
      if (res.stop_reason === 'refusal' || !res.parsed_output) throw new BadRequestException('The AI could not triage this snapshot');
      const [row] = await this.db.insert(aiReports).values({ kind: 'triage', title: res.parsed_output.headline, content: res.parsed_output, createdBy: user.id }).returning();
      await this.record(user, 'triage', started, usage);
      return row;
    } catch (e) {
      await this.record(user, 'triage', started, usage, (e as Error).message);
      throw this.apiError(e);
    }
  }

  /* ------------------------------------------------------------ briefing */

  async briefing(user: AuthUser) {
    const client = this.requireClient();
    const can = (d: DocType) => this.access.can(user, d, 'view');
    const data: Record<string, unknown> = { date: new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh', dateStyle: 'full' }) };
    if (await can('invoice')) {
      const y = await this.analytics.compute(user, new Date(Date.now() - DAY), new Date());
      const w = await this.analytics.compute(user, new Date(Date.now() - 7 * DAY), new Date());
      data.yesterday = y.kpis;
      data.last7Days = { kpis: w.kpis, insights: w.insights, worstVehicles: w.vehicles.slice(-5), topLanes: w.lanes.slice(0, 5) };
    }
    if (await can('job_card')) data.workshop = await this.workshop.summary(user, 7);
    if (await can('sos')) data.safety = await this.safety.sosSummary();
    if (await can('payroll')) {
      const o = await this.drivers.overview(user);
      data.drivers = { ...o, attendance30: undefined, roster: undefined };
    }
    data.signals = await this.signals(user, 24);
    const usage: Usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const started = Date.now();
    try {
      const res = await client.beta.messages.parse({
        model: config.aiModel,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: 'medium', format: zodOutputFormat(BriefingSchema) },
        system: [{ type: 'text', text: BRIEFING_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Data for today's briefing:\n${toolJson(data, 150_000)}` }],
      });
      addUsage(usage, res.usage);
      if (res.stop_reason === 'refusal' || !res.parsed_output) throw new BadRequestException('The AI could not write the briefing');
      const [row] = await this.db.insert(aiReports).values({ kind: 'briefing', title: res.parsed_output.title, content: res.parsed_output, createdBy: user.id || null }).returning();
      await this.record(user, 'briefing', started, usage);
      return row;
    } catch (e) {
      await this.record(user, 'briefing', started, usage, (e as Error).message);
      throw this.apiError(e);
    }
  }

  /** Writes today's briefing once, after the configured hour, using a Traccar service login. */
  private async maybeBriefing() {
    const now = new Date();
    const hour = Number(now.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
    if (hour < (config.aiBriefingHour ?? 25)) return;
    const startOfDay = new Date(now.getTime() - (hour * 3_600_000 + now.getMinutes() * 60_000));
    const [done] = await this.db.select({ id: aiReports.id }).from(aiReports).where(and(eq(aiReports.kind, 'briefing'), isNull(aiReports.createdBy), gte(aiReports.createdAt, startOfDay)));
    if (done) return;
    const res = await fetch(`${config.traccarUrl}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: config.traccarServiceEmail, password: config.traccarServicePassword }) });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (!res.ok || !cookie) throw new Error(`Traccar service login failed (HTTP ${res.status})`);
    await this.briefing({ id: 0, name: 'Daily briefing', email: config.traccarServiceEmail, administrator: true, role: 'admin', cookie });
  }

  async reports(kind?: string) {
    return this.db.select().from(aiReports).where(kind ? eq(aiReports.kind, kind) : undefined).orderBy(desc(aiReports.id)).limit(30);
  }

  /* ---------------------------------------------------------- documents */

  /** Reads a scanned document or photo and returns suggested field values; nothing is saved. */
  async extract(user: AuthUser, attachmentId: number, kind: string) {
    if (!(kind in EXTRACTORS)) throw new BadRequestException('kind must be compliance or repair_bill');
    const client = this.requireClient();
    const [file] = await this.db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!file) throw new NotFoundException('Attachment not found');
    await this.access.require(user, file.docType as DocType, 'view');
    const data = file.data.toString('base64');
    const source: Anthropic.Beta.BetaContentBlockParam =
      file.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : /^image\/(png|jpeg|webp|gif)$/.test(file.mime)
          ? { type: 'image', source: { type: 'base64', media_type: file.mime as 'image/png', data } }
          : (() => {
              throw new BadRequestException('Only images and PDFs can be read');
            })();
    const ex = EXTRACTORS[kind as ExtractKind];
    const usage: Usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const started = Date.now();
    try {
      const res = await client.beta.messages.parse({
        model: config.aiModel,
        max_tokens: 8000,
        ...FALLBACK,
        output_config: { effort: 'medium', format: zodOutputFormat(ex.schema) },
        messages: [{ role: 'user', content: [source, { type: 'text', text: ex.prompt }] }],
      });
      addUsage(usage, res.usage);
      if (res.stop_reason === 'refusal' || !res.parsed_output) throw new BadRequestException('The document could not be read');
      await this.record(user, 'extract', started, usage);
      await this.audit.log(user, 'ai_extract', file.docType, file.docId, { attachmentId, kind });
      return { kind, attachmentId, fields: res.parsed_output };
    } catch (e) {
      await this.record(user, 'extract', started, usage, (e as Error).message);
      throw this.apiError(e);
    }
  }

  async usage(days: number) {
    const rows = await this.db.select().from(aiRuns).where(gte(aiRuns.createdAt, new Date(Date.now() - days * DAY)));
    const by = new Map<string, { feature: string; runs: number; failed: number; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }>();
    for (const r of rows) {
      const f = by.get(r.feature) ?? { feature: r.feature, runs: 0, failed: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      f.runs++;
      if (!r.ok) f.failed++;
      f.requests += r.requests;
      f.inputTokens += r.inputTokens;
      f.outputTokens += r.outputTokens;
      f.cacheReadTokens += r.cacheReadTokens;
      by.set(r.feature, f);
    }
    return { days, features: [...by.values()] };
  }
}
