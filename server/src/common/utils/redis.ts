import Redis, { RedisOptions } from 'ioredis';

/** Parse Redis URL into ioredis options. */
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

// Bull requires this retry/ready-check behavior on its own clients.
export function buildBullRedisOptions(redisUrl: string): RedisOptions {
  return {
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
