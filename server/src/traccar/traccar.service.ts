import { Injectable } from '@nestjs/common';
import { config } from '../config';

export interface TraccarUser {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  readonly: boolean;
  disabled: boolean;
}

/**
 * Thin client for the Traccar REST API. Requests are made on behalf of the
 * logged-in user by forwarding their Traccar session cookie, so Traccar's own
 * permissions (which devices a user may see) are always respected.
 */
@Injectable()
export class TraccarService {
  private sessions = new Map<string, { user: TraccarUser; expires: number }>();

  /** Resolves a Traccar session cookie to its user, or null if the session is invalid. */
  async sessionUser(cookie: string): Promise<TraccarUser | null> {
    const hit = this.sessions.get(cookie);
    if (hit && hit.expires > Date.now()) return hit.user;
    const res = await fetch(`${config.traccarUrl}/api/session`, { headers: { Cookie: cookie } });
    if (!res.ok) {
      this.sessions.delete(cookie);
      return null;
    }
    const user = (await res.json()) as TraccarUser;
    this.sessions.set(cookie, { user, expires: Date.now() + config.sessionCacheMs });
    return user;
  }

  async get<T>(cookie: string, path: string): Promise<T> {
    const res = await fetch(`${config.traccarUrl}/api${path}`, {
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Traccar GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }
}
