import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { attachments } from '../db/schema';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { validationError } from './crud';
import { DOC_TYPES, type DocType } from './doctypes';

const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;
const docType = z.enum(Object.keys(DOC_TYPES) as [DocType, ...DocType[]]);
const upload = z.object({
  docType,
  docId: z.coerce.number().int().positive(),
  filename: z.string().trim().min(1).max(200),
  mime: z.string().regex(ALLOWED, 'only images, PDF, CSV and XLSX files can be attached'),
  data: z.string().min(1, 'file is empty'),
});
const meta = { id: attachments.id, docType: attachments.docType, docId: attachments.docId, filename: attachments.filename, mime: attachments.mime, size: attachments.size, createdBy: attachments.createdBy, createdAt: attachments.createdAt };

/** Files on ERP documents. Uploads are base64 JSON; access follows the document's permissions. */
@Controller('attachments')
export class AttachmentsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('docType') dt: string, @Query('docId') docId: string) {
    const t = docType.safeParse(dt);
    if (!t.success) throw new BadRequestException('docType is not valid');
    await this.access.require(u, t.data, 'view');
    return this.db.select(meta).from(attachments).where(and(eq(attachments.docType, t.data), eq(attachments.docId, Number(docId)))).orderBy(desc(attachments.id));
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const parsed = upload.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    await this.access.require(u, d.docType, 'edit');
    const data = Buffer.from(d.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (!data.length) throw new BadRequestException('file is empty');
    if (data.length > config.maxUploadBytes) throw new BadRequestException(`file is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB`);
    const [row] = await this.db.insert(attachments).values({ docType: d.docType, docId: d.docId, filename: d.filename, mime: d.mime, size: data.length, data, createdBy: u.id }).returning(meta);
    await this.audit.log(u, 'attach', d.docType, d.docId, { filename: d.filename, size: data.length });
    return row;
  }

  @Get(':id')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const [row] = await this.db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) throw new NotFoundException();
    await this.access.require(u, row.docType as DocType, 'view');
    return new StreamableFile(row.data, { type: row.mime, disposition: `inline; filename="${row.filename.replace(/["\\\r\n]/g, '_')}"`, length: row.size });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const [row] = await this.db.select(meta).from(attachments).where(eq(attachments.id, id));
    if (!row) throw new NotFoundException();
    await this.access.require(u, row.docType as DocType, 'edit');
    await this.db.delete(attachments).where(eq(attachments.id, id));
    await this.audit.log(u, 'detach', row.docType, row.docId, { filename: row.filename });
  }
}
