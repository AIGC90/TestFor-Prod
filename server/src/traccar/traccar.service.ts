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
    return this.request<T>(cookie, 'GET', path);
  }

  async post<T>(cookie: string, path: string, body: unknown): Promise<T> {
    return this.request<T>(cookie, 'POST', path, body);
  }

  private async request<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.traccarUrl}/api${path}`, {
      method,
      headers: { Cookie: cookie, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = (await res.text()).split('\n')[0].slice(0, 200);
      throw new Error(`Traccar ${method} ${path} failed: ${res.status} ${text}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
