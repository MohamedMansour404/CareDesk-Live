import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  it('fails fast when redis is unavailable in redis-required mode', async () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'security.idempotencyMode' ? 'redis-required' : undefined,
      ),
    } as unknown as ConfigService;

    const service = new IdempotencyService(null, configService);

    await expect(
      service.runOnce(
        'scope',
        'id-1',
        { lockTtlSeconds: 5, completionTtlSeconds: 30 },
        () => Promise.resolve('ok'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses local fallback only in best-effort-local mode', async () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'security.idempotencyMode' ? 'best-effort-local' : undefined,
      ),
    } as unknown as ConfigService;

    const service = new IdempotencyService(null, configService);

    const first = await service.runOnce(
      'scope',
      'id-2',
      { lockTtlSeconds: 5, completionTtlSeconds: 30 },
      () => Promise.resolve('ok'),
    );

    const second = await service.runOnce(
      'scope',
      'id-2',
      { lockTtlSeconds: 5, completionTtlSeconds: 30 },
      () => Promise.resolve('should-not-run'),
    );

    expect(first).toEqual({ executed: true, result: 'ok' });
    expect(second).toEqual({ executed: false, reason: 'already-completed' });
  });
});
