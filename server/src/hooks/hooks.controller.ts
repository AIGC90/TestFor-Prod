import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { traccarEvents } from '../db/schema';

interface ForwardedEvent {
  event?: { id?: number; type?: string; deviceId?: number; eventTime?: string };
  device?: { name?: string };
}

/** Receives Traccar event forwarding (event.forward.url) and stores events for ERP processing. */
@Controller('hooks')
export class HooksController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Post('traccar-event')
  @HttpCode(204)
  async traccarEvent(@Headers('x-hook-secret') secret: string | undefined, @Body() body: ForwardedEvent) {
    if (secret !== config.hookSecret) throw new UnauthorizedException();
    const e = body.event ?? {};
    await this.db
      .insert(traccarEvents)
      .values({
        traccarEventId: e.id ?? null,
        type: e.type ?? 'unknown',
        deviceId: e.deviceId ?? null,
        deviceName: body.device?.name ?? null,
        eventTime: e.eventTime ? new Date(e.eventTime) : null,
        payload: body,
      })
      .onConflictDoNothing();
  }
}
