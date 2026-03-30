import Redis, { RedisOptions } from 'ioredis';

/**
 * Parse a Redis URL into base connection options with TLS auto-detection.
 * This is the foundation — callers add their own behavioural overrides.
 */
function parseRedisUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const useTls = url.protocol === 'rediss:';

  const options: RedisOptions = {
    host: url.hostname,
    port: parseInt(url.port, 10) || (useTls ? 6380 : 6379),
  };

  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.username && url.username !== 'default') {
    options.username = url.username;
  }
  if (useTls) {
    options.tls = { rejectUnauthorized: false };
  }

  return options;
}

// ─────────────────────────────────────────────────
// A.  General-purpose Redis (Analytics, Health, etc.)
// ─────────────────────────────────────────────────

export function buildRedisOptions(redisUrl: string): RedisOptions {
  return {
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
  };
}

export function createRedisClient(
  redisUrl: string,
  overrides: Partial<RedisOptions> = {},
): Redis {
  const options = buildRedisOptions(redisUrl);
  return new Redis({ ...options, ...overrides });
}

// ─────────────────────────────────────────────────
// B.  Bull-safe Redis config (STRICT)
//     Bull creates its own ioredis clients and REQUIRES:
//       - maxRetriesPerRequest = null
//       - enableReadyCheck = false  (or omitted)
// ─────────────────────────────────────────────────

export function buildBullRedisOptions(redisUrl: string): RedisOptions {
  return {
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null, // Bull requirement
    enableReadyCheck: false, // Bull requirement
  };
}
