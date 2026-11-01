import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { tyreEvents, tyreInterchanges, tyres } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { crudController } from '../erp/crud';
import { requiredText, text } from '../erp/zod-helpers';
import { LAYOUTS, TyresService, WATCH_NSD } from './tyres.service';

const optNum = z.coerce.number().min(0).nullish().transform((v) => (v === undefined ? null : v));

export const TyreRegisterController = crudController({
  path: 'tyres/register',
  docType: 'tyre',
  table: tyres,
  searchColumns: [tyres.serial, tyres.brand, tyres.model, tyres.size, tyres.vehicleNo],
  filters: { status: tyres.status, vehicleNo: tyres.vehicleNo, brand: tyres.brand },
  orderBy: [desc(tyres.id)],
  schema: z.object({
    serial: z.string().trim().toUpperCase().min(2).max(60),
    brand: requiredText(60),
    model: text(80),
    size: requiredText(40),
    tyreType: z.enum(['radial', 'bias']).default('radial'),
    purchaseCost: z.coerce.number().min(0).default(0),
    purchaseDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullish()).transform((v) => v ?? null),
    vendorId: z.coerce.number().int().positive().nullish(),
    originalNsd: z.coerce.number().min(1).max(30).default(16),
    targetPressure: optNum,
    notes: text(1000),
  }),
  // new casings start in store with full tread
  beforeCreate: (input) => ({ ...input, status: 'in_store', lastNsd: input.originalNsd, lastNsdAt: new Date() }),
  afterWrite: async (row, { db, user }, op) => {
    if (op === 'create') {
      await db.insert(tyreEvents).values({ tyreId: row.id as number, type: 'purchase', cost: row.purchaseCost as number, nsd: row.originalNsd as number, createdBy: user.id });
    }
  },
  canDelete: (row) => (row.status === 'in_store' ? null : 'Only a tyre that is in store can be deleted'),
});

@Controller('tyres')
export class TyresController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tyresSvc: TyresService,
    private readonly access: AccessService,
  ) {}

  private view = (u: AuthUser) => this.access.require(u, 'tyre', 'view');
  private edit = (u: AuthUser) => this.access.require(u, 'tyre', 'edit');

  @Get('layouts')
  layouts() {
    return LAYOUTS;
  }

  @Get('overview')
  async overview(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.tyresSvc.overview(u);
  }

  @Get('with-km')
  async withKm(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    await this.view(u);
    return this.tyresSvc.withKm(u, status ? eq(tyres.status, status) : undefined);
  }

  @Get('vehicle/:vehicleNo')
  async vehicle(@CurrentUser() u: AuthUser, @Param('vehicleNo') vehicleNo: string) {
    await this.view(u);
    return this.tyresSvc.vehicleMap(u, vehicleNo);
  }

  @Put('vehicle/:vehicleNo/layout')
  async layout(@CurrentUser() u: AuthUser, @Param('vehicleNo') vehicleNo: string, @Body() body: { layout?: string }) {
    await this.edit(u);
    return this.tyresSvc.setLayout(u, vehicleNo, String(body?.layout ?? ''));
  }

  @Get('nsd-alerts')
  async nsd(@CurrentUser() u: AuthUser, @Query('threshold') threshold?: string) {
    await this.view(u);
    const t = threshold === undefined ? WATCH_NSD : Number(threshold);
    if (!(t >= 0 && t <= 30)) throw new BadRequestException('threshold must be between 0 and 30 mm');
    return this.tyresSvc.nsdAlerts(u, t);
  }

  @Get('cost-by-vehicle')
  async cost(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.tyresSvc.costByVehicle(u);
  }

  @Get('performance')
  async performance(@CurrentUser() u: AuthUser, @Query('groupBy') groupBy = 'brand') {
    await this.view(u);
    if (!['brand', 'model', 'size'].includes(groupBy)) throw new BadRequestException('groupBy must be brand, model or size');
    return this.tyresSvc.performance(u, groupBy as 'brand');
  }

  @Get('events')
  async events(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    await this.view(u);
    const where: SQL[] = [];
    if (q.type) where.push(eq(tyreEvents.type, q.type));
    if (q.tyreId) where.push(eq(tyreEvents.tyreId, Number(q.tyreId)));
    if (q.vehicleNo) where.push(eq(tyreEvents.vehicleNo, q.vehicleNo.toUpperCase()));
    if (q.from) where.push(gte(tyreEvents.at, new Date(q.from)));
    if (q.to) where.push(lte(tyreEvents.at, new Date(q.to)));
    return this.db
      .select({ event: tyreEvents, serial: tyres.serial, brand: tyres.brand, model: tyres.model, size: tyres.size })
      .from(tyreEvents)
      .innerJoin(tyres, eq(tyres.id, tyreEvents.tyreId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(tyreEvents.at), desc(tyreEvents.id))
      .limit(2000)
      .then((rows) => rows.map((r) => ({ ...r.event, serial: r.serial, brand: r.brand, model: r.model, size: r.size })));
  }

  @Get('interchanges')
  async interchanges(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.db.select().from(tyreInterchanges).orderBy(desc(tyreInterchanges.at)).limit(500);
  }

  @Post('interchanges')
  async interchange(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.interchange(u, body);
  }

  @Post('fit')
  async fit(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.fit(u, body);
  }

  @Post(':id/remove')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.remove(u, id, body);
  }

  @Post(':id/inspect')
  async inspect(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.inspect(u, id, body);
  }

  @Post(':id/retread-in')
  async retreadIn(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.retreadIn(u, id, body);
  }

  @Post(':id/repair')
  async repair(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.repair(u, id, body);
  }

  @Post(':id/scrap')
  async scrap(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.dispose(u, id, 'scrap', body);
  }

  @Post(':id/sell')
  async sell(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.tyresSvc.dispose(u, id, 'sale', body);
  }
}
