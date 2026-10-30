import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { type Db, InjectDb } from '../db/db.module';
import { userRoles } from '../db/schema';
import { TraccarService } from '../traccar/traccar.service';

export const ROLES = [
  'admin',
  'fleet_supervisor',
  'workshop_manager',
  'technician',
  'storekeeper',
  'accountant',
  'driver',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  role: Role;
  /** Raw cookie header, used to call Traccar on the user's behalf. */
  cookie: string;
}

const PUBLIC = 'public';
const REQUIRED_ROLES = 'roles';
export const Public = () => SetMetadata(PUBLIC, true);
/** Restricts a route to the listed roles (admins always pass). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);

/** Global guard: every /erp route needs a valid Traccar session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly traccar: TraccarService,
    @InjectDb() private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const session = req.cookies?.JSESSIONID;
    if (!session) throw new UnauthorizedException();
    const cookie = `JSESSIONID=${session}`;
    const tUser = await this.traccar.sessionUser(cookie);
    if (!tUser || tUser.disabled) throw new UnauthorizedException();

    const [row] = await this.db.select().from(userRoles).where(eq(userRoles.traccarUserId, tUser.id));
    const role: Role = tUser.administrator ? 'admin' : ((row?.role as Role) ?? 'viewer');
    req.user = { id: tUser.id, name: tUser.name, email: tUser.email, administrator: tUser.administrator, role, cookie };

    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required?.length && role !== 'admin' && !required.includes(role)) throw new ForbiddenException();
    return true;
  }
}
