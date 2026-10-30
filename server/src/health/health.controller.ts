import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';

@Controller()
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
