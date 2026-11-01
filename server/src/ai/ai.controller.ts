import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { AccessService } from '../erp/access.service';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly access: AccessService,
  ) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  /** Copilot: any signed-in user; each tool checks what their role may see. */
  @Post('chat')
  chat(@CurrentUser() u: AuthUser, @Body() body: { conversationId?: number; message?: string }) {
    return this.ai.chat(u, body ?? {});
  }

  @Get('conversations')
  conversations(@CurrentUser() u: AuthUser) {
    return this.ai.conversations(u);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ai.conversation(u, id);
  }

  @Get('actions')
  async actions(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    await this.access.require(u, 'ai_action', 'view');
    return this.ai.actions(status);
  }

  @Get('signals')
  async signals(@CurrentUser() u: AuthUser, @Query('hours') hours = '24') {
    await this.access.require(u, 'ai_ops', 'view');
    return this.ai.signals(u, this.hours(hours));
  }

  @Post('triage')
  async triage(@CurrentUser() u: AuthUser, @Body() body: { hours?: number }) {
    await this.access.require(u, 'ai_ops', 'create');
    return this.ai.triage(u, this.hours(String(body?.hours ?? 24)));
  }

  @Post('briefing')
  async briefing(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'ai_ops', 'create');
    return this.ai.briefing(u);
  }

  @Get('reports')
  async reports(@CurrentUser() u: AuthUser, @Query('kind') kind?: string) {
    await this.access.require(u, 'ai_ops', 'view');
    return this.ai.reports(kind);
  }

  @Post('extract')
  extract(@CurrentUser() u: AuthUser, @Body() body: { attachmentId?: number; kind?: string }) {
    if (!body?.attachmentId) throw new BadRequestException('attachmentId is required');
    return this.ai.extract(u, Number(body.attachmentId), String(body.kind ?? ''));
  }

  @Get('usage')
  async usage(@CurrentUser() u: AuthUser, @Query('days') days = '30') {
    await this.access.require(u, 'ai_ops', 'view');
    return this.ai.usage(Math.min(365, Math.max(1, Number(days) || 30)));
  }

  private hours(h: string) {
    const n = Number(h);
    if (!(n >= 1 && n <= 168)) throw new BadRequestException('hours must be 1 to 168');
    return n;
  }
}
