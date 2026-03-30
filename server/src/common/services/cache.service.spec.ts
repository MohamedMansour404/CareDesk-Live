import { CacheService } from './cache.service';

describe('CacheService namespace invalidation', () => {
  const buildService = () => {
    const pipeline = {
      setex: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    const redis = {
      pipeline: jest.fn(() => pipeline),
      smembers: jest.fn().mockResolvedValue(['k1', 'k2']),
      del: jest.fn().mockResolvedValue(2),
    };

    const service = new CacheService(redis as never);
    return { service, redis, pipeline };
  };

  it('tracks keys in namespace index on setTracked', async () => {
    const { service, redis, pipeline } = buildService();

    await service.setTracked('conv:queue:1:20', { ok: true }, 10, 'conv:queue');

    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.setex).toHaveBeenCalledWith(
      'conv:queue:1:20',
      10,
      JSON.stringify({ ok: true }),
    );
    expect(pipeline.sadd).toHaveBeenCalledWith(
      'cache:index:conv:queue',
      'conv:queue:1:20',
    );
    expect(pipeline.expire).toHaveBeenCalledWith(
      'cache:index:conv:queue',
      86400,
    );
  });

  it('invalidates namespace via tracked set without scan-pattern calls', async () => {
    const { service, redis } = buildService();

    await service.invalidateNamespace('conv:queue');

    expect(redis.smembers).toHaveBeenCalledWith('cache:index:conv:queue');
    expect(redis.del).toHaveBeenNthCalledWith(1, 'k1', 'k2');
    expect(redis.del).toHaveBeenNthCalledWith(2, 'cache:index:conv:queue');
  });
});
