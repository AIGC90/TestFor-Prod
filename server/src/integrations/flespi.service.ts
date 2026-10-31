import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { integrations } from '../db/schema';
import { AuditService } from '../erp/audit.service';
import { TraccarService } from '../traccar/traccar.service';
import { hint, open, seal } from './secret-box';

const KEY = 'flespi';
const STREAM_NAME = 'FleetOne to Traccar';
export const TRACCAR_FLESPI_PORT = 5149;

export interface FlespiSettings {
  /** Public host or IP of the Traccar server, reachable from flespi.io. */
  traccarHost: string;
  traccarPort: number;
}
interface FlespiState {
  streamId?: number;
  lastImportAt?: string;
  lastImportCount?: number;
  lastTestAt?: string;
  lastTestOk?: boolean;
}
export interface FlespiDevice {
  id: number;
  name: string;
  ident: string | null;
  connected: boolean;
  lastActive: number | null;
  deviceTypeId: number | null;
}
interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
}

/**
 * Connects a flespi.io account to Traccar: flespi devices are created in Traccar
 * (flespi ident = Traccar unique id) and a flespi "traccar" stream pushes their
 * messages to Traccar's flespi port. Commands stay on flespi; the stream is one-way.
 */
@Injectable()
export class FlespiService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly traccar: TraccarService,
    private readonly audit: AuditService,
  ) {}

  private async row() {
    const [r] = await this.db.select().from(integrations).where(eq(integrations.key, KEY));
    return r;
  }

  private async token(): Promise<string> {
    const r = await this.row();
    if (!r?.secret) throw new BadRequestException('Add a flespi token first');
    return open(r.secret);
  }

  private async saveState(patch: FlespiState) {
    const r = await this.row();
    await this.db
      .update(integrations)
      .set({ state: { ...((r?.state as FlespiState) ?? {}), ...patch }, updatedAt: new Date() })
      .where(eq(integrations.key, KEY));
  }

  /** Calls the flespi REST API and unwraps its { result, errors } envelope. */
  private async api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T[]> {
    let res: Response;
    try {
      res = await fetch(`${config.flespiApiUrl}${path}`, {
        method,
        headers: {
          Authorization: `FlespiToken ${token ?? (await this.token())}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new BadGatewayException(`Could not reach flespi: ${(e as Error).message}`);
    }
    const payload = (await res.json().catch(() => ({}))) as { result?: T[]; errors?: { reason?: string }[] };
    if (!res.ok || payload.errors?.length) {
      const reason = payload.errors?.map((e) => e.reason).filter(Boolean).join('; ') || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403 || /token/i.test(reason)) throw new BadRequestException(`flespi rejected the token: ${reason}`);
      throw new BadGatewayException(`flespi error: ${reason}`);
    }
    return payload.result ?? [];
  }

  async status() {
    const r = await this.row();
    const settings = (r?.config as Partial<FlespiSettings>) ?? {};
    return {
      configured: Boolean(r?.secret),
      tokenHint: r?.secret ? hint(open(r.secret)) : null,
      traccarHost: settings.traccarHost ?? null,
      traccarPort: settings.traccarPort ?? TRACCAR_FLESPI_PORT,
      ...((r?.state as FlespiState) ?? {}),
    };
  }

  /** Saves settings; a new token is checked against flespi before it is stored. */
  async configure(user: AuthUser, input: { token?: string; traccarHost: string; traccarPort?: number }) {
    if (input.token) await this.api('GET', '/auth/info', undefined, input.token);
    const existing = await this.row();
    const values = {
      key: KEY,
      secret: input.token ? seal(input.token) : (existing?.secret ?? null),
      config: { traccarHost: input.traccarHost, traccarPort: input.traccarPort ?? TRACCAR_FLESPI_PORT },
      state: existing?.state ?? {},
      updatedAt: new Date(),
    };
    await this.db.insert(integrations).values(values).onConflictDoUpdate({ target: integrations.key, set: values });
    await this.audit.log(user, 'update', 'integration', KEY, { traccarHost: input.traccarHost, tokenChanged: Boolean(input.token) });
    return this.status();
  }

  async test() {
    try {
      const [info] = await this.api<Record<string, unknown>>('GET', '/auth/info');
      await this.saveState({ lastTestAt: new Date().toISOString(), lastTestOk: true });
      return { ok: true, info };
    } catch (e) {
      await this.saveState({ lastTestAt: new Date().toISOString(), lastTestOk: false });
      throw e;
    }
  }

  async flespiDevices(): Promise<FlespiDevice[]> {
    const list = await this.api<{
      id: number;
      name: string;
      configuration?: { ident?: string };
      connected?: boolean;
      last_active?: number;
      device_type_id?: number;
    }>('GET', '/gw/devices/all?fields=id,name,configuration,connected,last_active,device_type_id');
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      ident: d.configuration?.ident ?? null,
      connected: Boolean(d.connected),
      lastActive: d.last_active ?? null,
      deviceTypeId: d.device_type_id ?? null,
    }));
  }

  /** flespi devices with whether each already exists in Traccar. */
  async devices(user: AuthUser) {
    const [flespi, traccar] = await Promise.all([this.flespiDevices(), this.traccar.get<TraccarDevice[]>(user.cookie, '/devices')]);
    const byUniqueId = new Map(traccar.map((d) => [d.uniqueId, d]));
    return flespi.map((d) => ({ ...d, traccarDeviceId: d.ident ? (byUniqueId.get(d.ident)?.id ?? null) : null }));
  }

  /** Creates Traccar devices for flespi devices that are missing (all, or the given flespi ids). */
  async importDevices(user: AuthUser, ids?: number[]) {
    const list = await this.devices(user);
    const wanted = list.filter((d) => (!ids?.length || ids.includes(d.id)) && d.ident && !d.traccarDeviceId);
    const created: { flespiId: number; traccarId: number; name: string }[] = [];
    const failed: { flespiId: number; name: string; error: string }[] = [];
    for (const d of wanted) {
      try {
        const dev = await this.traccar.post<TraccarDevice>(user.cookie, '/devices', {
          name: d.name || d.ident,
          uniqueId: d.ident,
          attributes: { source: 'flespi', flespiId: d.id },
        });
        created.push({ flespiId: d.id, traccarId: dev.id, name: dev.name });
      } catch (e) {
        failed.push({ flespiId: d.id, name: d.name, error: (e as Error).message });
      }
    }
    const skipped = list.filter((d) => !d.ident).map((d) => ({ flespiId: d.id, name: d.name, reason: 'no ident' }));
    await this.saveState({ lastImportAt: new Date().toISOString(), lastImportCount: created.length });
    await this.audit.log(user, 'import', 'integration', KEY, { created: created.length, failed: failed.length });
    return { created, failed, skipped };
  }

  /**
   * Makes sure a "traccar" stream exists that points at our Traccar server and is
   * subscribed to the given flespi devices (default: all devices that exist in Traccar).
   */
  async ensureStream(user: AuthUser, ids?: number[]) {
    const status = await this.status();
    if (!status.traccarHost) throw new BadRequestException('Set the public Traccar host first');
    const [protocol] = await this.api<{ id: number; name: string; config_schema?: { properties?: Record<string, unknown> } }>(
      'GET',
      '/gw/stream-protocols/name=traccar?fields=id,name,config_schema',
    );
    if (!protocol) throw new BadGatewayException('flespi does not offer a "traccar" stream protocol for this account');

    // The configuration schema belongs to the protocol; fill whichever address fields it declares.
    const props = Object.keys(protocol.config_schema?.properties ?? {});
    const configuration: Record<string, unknown> = {};
    if (props.includes('uri')) configuration.uri = `http://${status.traccarHost}:${status.traccarPort}`;
    if (props.includes('host') || !props.includes('uri')) configuration.host = status.traccarHost;
    if (props.includes('port') || !props.includes('uri')) configuration.port = status.traccarPort;

    let streamId = status.streamId;
    if (streamId) {
      const existing = await this.api<{ id: number }>('GET', `/gw/streams/${streamId}?fields=id`).catch(() => []);
      if (!existing.length) streamId = undefined;
    }
    if (streamId) {
      await this.api('PUT', `/gw/streams/${streamId}`, { configuration });
    } else {
      const [stream] = await this.api<{ id: number }>('POST', '/gw/streams?fields=id', [
        { name: STREAM_NAME, protocol_id: protocol.id, configuration, enabled: true },
      ]);
      streamId = stream.id;
    }

    const devices = await this.devices(user);
    const subscribe = devices.filter((d) => d.traccarDeviceId && (!ids?.length || ids.includes(d.id))).map((d) => d.id);
    if (subscribe.length) await this.api('POST', `/gw/streams/${streamId}/devices/${subscribe.join(',')}`);
    await this.saveState({ streamId });
    await this.audit.log(user, 'update', 'integration', KEY, { streamId, subscribed: subscribe.length });
    return { streamId, subscribed: subscribe.length, configuration };
  }
}
