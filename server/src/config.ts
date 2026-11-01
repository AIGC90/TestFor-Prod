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
  // Vahan / ULIP aggregator for RC, insurance, fitness, PUC and permit lookups (optional).
  vahanApiUrl: process.env.VAHAN_API_URL ?? '',
  vahanApiKey: process.env.VAHAN_API_KEY ?? '',
  // FASTag issuer / aggregator API for balances and toll transactions (optional).
  fastagApiUrl: process.env.FASTAG_API_URL ?? '',
  fastagApiKey: process.env.FASTAG_API_KEY ?? '',
  // Video telematics media server (JT/T 1078 etc.). Stream URL template, e.g. https://media.example.com/live/{deviceId}/{channel}.m3u8
  dashcamStreamUrl: process.env.DASHCAM_STREAM_URL ?? '',
  // AI: the Anthropic key comes from ANTHROPIC_API_KEY (an environment secret); without it AI features are off.
  aiEnabled: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  aiModel: process.env.AI_MODEL ?? 'claude-opus-5-5',
  // Daily AI briefing hour (KSA time, 0-23); needs a Traccar service login to read fleet data unattended.
  aiBriefingHour: process.env.AI_BRIEFING_HOUR ? Number(process.env.AI_BRIEFING_HOUR) : null,
  traccarServiceEmail: process.env.TRACCAR_SERVICE_EMAIL ?? '',
  traccarServicePassword: process.env.TRACCAR_SERVICE_PASSWORD ?? '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024),
};
