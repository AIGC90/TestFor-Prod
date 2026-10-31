import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { auditLog } from '../db/schema';

@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(user: Pick<AuthUser, 'id' | 'name'> | null, action: string, entity: string, entityId: string | number | null, data?: unknown) {
    await this.db.insert(auditLog).values({
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      data: data ?? null,
    });
  }
}
