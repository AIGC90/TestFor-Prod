import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { z } from 'zod';
import { ROLES, Roles } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { userRoles } from '../db/schema';

const body = z.object({ role: z.enum(ROLES) });

/** ERP role assignments for Traccar users (Traccar administrators are always admin). */
@Controller('users')
export class RolesController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get('roles')
  async list() {
    return this.db.select({ userId: userRoles.traccarUserId, role: userRoles.role }).from(userRoles);
  }

  @Roles('admin')
  @Put(':id/role')
  async set(@Param('id', ParseIntPipe) id: number, @Body() raw: unknown) {
    const parsed = body.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(`role must be one of: ${ROLES.join(', ')}`);
    await this.db
      .insert(userRoles)
      .values({ traccarUserId: id, role: parsed.data.role })
      .onConflictDoUpdate({ target: userRoles.traccarUserId, set: { role: parsed.data.role, updatedAt: new Date() } });
    return { userId: id, role: parsed.data.role };
  }
}
