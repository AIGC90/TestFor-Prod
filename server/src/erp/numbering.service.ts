import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Db, InjectDb } from '../db/db.module';
import { numberSeries } from '../db/schema';

/** Allocates sequential document numbers per prefix and year, e.g. JC-2026-0001 (a rolled-back document can leave a gap). */
@Injectable()
export class NumberingService {
  constructor(@InjectDb() private readonly db: Db) {}

  async next(prefix: string, date = new Date(), width = 4): Promise<string> {
    const year = date.getFullYear();
    const [row] = await this.db
      .insert(numberSeries)
      .values({ prefix, year, last: 1 })
      .onConflictDoUpdate({ target: [numberSeries.prefix, numberSeries.year], set: { last: sql`${numberSeries.last} + 1` } })
      .returning({ last: numberSeries.last });
    return `${prefix}-${year}-${String(row.last).padStart(width, '0')}`;
  }
}
