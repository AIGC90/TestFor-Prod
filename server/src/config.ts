export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/erp',
  traccarUrl: process.env.TRACCAR_URL ?? 'http://localhost:8082',
  // Shared secret Traccar sends with forwarded events (event.forward.header).
  hookSecret: process.env.HOOK_SECRET ?? 'dev-hook-secret',
  sessionCacheMs: Number(process.env.SESSION_CACHE_MS ?? 30_000),
  // Key for encrypting connector secrets at rest. MUST be set in production.
  secretKey: process.env.SECRET_KEY ?? 'dev-only-secret-key-change-me',
  flespiApiUrl: process.env.FLESPI_API_URL ?? 'https://flespi.io',
};
