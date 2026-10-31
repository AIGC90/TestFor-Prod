import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth';
import { validationError } from '../erp/crud';
import { FlespiService, TRACCAR_FLESPI_PORT } from './flespi.service';

const settingsBody = z.object({
  token: z.string().trim().min(10).max(200).optional(),
  traccarHost: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'must be a host name or IP address without http:// or a path'),
  traccarPort: z.coerce.number().int().min(1).max(65535).default(TRACCAR_FLESPI_PORT),
});
const idsBody = z.object({ ids: z.array(z.number().int().positive()).max(5000).optional() });

/** External connectors. Admin only: they hold credentials and create devices. */
@Roles('admin')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly flespi: FlespiService) {}

  @Get('flespi')
  status() {
    return this.flespi.status();
  }

  @Put('flespi')
  configure(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = settingsBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    return this.flespi.configure(user, parsed.data);
  }

  @Post('flespi/test')
  test() {
    return this.flespi.test();
  }

  @Get('flespi/devices')
  devices(@CurrentUser() user: AuthUser) {
    return this.flespi.devices(user);
  }

  @Post('flespi/import')
  import(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = idsBody.safeParse(raw ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    return this.flespi.importDevices(user, parsed.data.ids);
  }

  @Post('flespi/stream')
  stream(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = idsBody.safeParse(raw ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    return this.flespi.ensureStream(user, parsed.data.ids);
  }
}
