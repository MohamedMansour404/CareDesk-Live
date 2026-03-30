function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseTrustProxy(
  value: string | undefined,
): boolean | number | string | string[] {
  if (!value || value.trim() === '') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  if (/^\d+$/.test(normalized)) {
    return parseInt(normalized, 10);
  }

  if (normalized.includes(',')) {
    return normalized
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return normalized;
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/caredesk',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: getRequiredEnv('JWT_SECRET'),
    expiration: process.env.JWT_EXPIRATION || '7d',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '30d',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct-v0.1',
  },

  ai: {
    provider: process.env.AI_PROVIDER || 'openrouter',
    cacheTtlMs: parseInt(process.env.AI_CACHE_TTL_MS ?? '300000', 10),
  },

  ws: {
    corsOrigin: process.env.WS_CORS_ORIGIN || 'http://localhost:5173',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
  },

  security: {
    rateLimit: {
      burst: {
        points: parseInt(process.env.RATE_LIMIT_BURST_POINTS ?? '60', 10),
        durationSeconds: parseInt(
          process.env.RATE_LIMIT_BURST_DURATION_SECONDS ?? '1',
          10,
        ),
        blockSeconds: parseInt(
          process.env.RATE_LIMIT_BURST_BLOCK_SECONDS ?? '2',
          10,
        ),
      },
      sustained: {
        points: parseInt(process.env.RATE_LIMIT_SUSTAINED_POINTS ?? '1200', 10),
        durationSeconds: parseInt(
          process.env.RATE_LIMIT_SUSTAINED_DURATION_SECONDS ?? '60',
          10,
        ),
        blockSeconds: parseInt(
          process.env.RATE_LIMIT_SUSTAINED_BLOCK_SECONDS ?? '30',
          10,
        ),
      },
      failClosed: (process.env.RATE_LIMIT_FAIL_CLOSED ?? 'true') === 'true',
    },
    idempotencyMode:
      process.env.IDEMPOTENCY_MODE ||
      (process.env.NODE_ENV === 'production'
        ? 'redis-required'
        : 'best-effort-local'),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  },
});
