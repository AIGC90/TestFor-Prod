import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { notificationReads } from '../db/schema';

const idsSchema = z.array(z.number().int().positive()).max(5000);

function parseIds(raw: string | undefined) {
  if (!raw) return [];
  const ids = raw.split(',').map(Number);
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new BadRequestException('ids must be a comma-separated list of event ids');
  return parsed.data;
}

@Controller('notifications')
export class NotificationsController {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Returns which of the given event ids the current user has read. */
  @Get('read')
  async read(@CurrentUser() user: AuthUser, @Query('ids') ids?: string) {
    const list = parseIds(ids);
    if (!list.length) return [];
    const rows = await this.db
      .select({ eventId: notificationReads.eventId })
      .from(notificationReads)
      .where(and(eq(notificationReads.userId, user.id), inArray(notificationReads.eventId, list)));
    return rows.map((r) => r.eventId);
  }

  @Post('read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Body() body: { ids?: unknown }) {
    const parsed = idsSchema.safeParse(body?.ids);
    if (!parsed.success) throw new BadRequestException('ids must be an array of event ids');
    if (!parsed.data.length) return;
    await this.db
      .insert(notificationReads)
      .values(parsed.data.map((eventId) => ({ userId: user.id, eventId })))
      .onConflictDoNothing();
  }

  @Post('unread')
  @HttpCode(204)
  async markUnread(@CurrentUser() user: AuthUser, @Body() body: { ids?: unknown }) {
    const parsed = idsSchema.safeParse(body?.ids);
    if (!parsed.success) throw new BadRequestException('ids must be an array of event ids');
    if (!parsed.data.length) return;
    await this.db
      .delete(notificationReads)
      .where(and(eq(notificationReads.userId, user.id), inArray(notificationReads.eventId, parsed.data)));
  }
}
