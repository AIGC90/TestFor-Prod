export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { Accept: 'application/json', ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!res.ok) throw new HttpError(res.status, (await res.text()) || res.statusText);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Builds a query string, repeating keys for array values (Traccar style: deviceId=1&deviceId=2). */
export function qs(params: Record<string, string | number | boolean | undefined | (string | number)[]>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.append(k, String(v));
  }
  return p.toString();
}
