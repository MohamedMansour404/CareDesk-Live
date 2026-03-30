import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { GlobalRateLimitMiddleware } from './global-rate-limit.middleware';

describe('GlobalRateLimitMiddleware', () => {
  const buildConfigService = (failClosed = true) =>
    ({
      get: jest.fn((key: string) => {
        if (key === 'security.rateLimit.failClosed') return failClosed;
        if (key === 'security.rateLimit.burst') {
          return { points: 2, durationSeconds: 1, blockSeconds: 2 };
        }
        if (key === 'security.rateLimit.sustained') {
          return { points: 10, durationSeconds: 60, blockSeconds: 30 };
        }
        return undefined;
      }),
    }) as unknown as ConfigService;

  it('fails closed if redis backend is unavailable', async () => {
    const middleware = new GlobalRateLimitMiddleware(
      buildConfigService(true),
      new JwtService({ secret: 'test-secret' }),
      null,
    );

    await expect(
      middleware.use(
        {
          headers: {},
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as unknown as Request,
        { setHeader: jest.fn() } as unknown as Response,
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throttles and sets retry-after header when burst limit exceeded', async () => {
    const jwtService = new JwtService({ secret: 'test-secret' });
    const token = jwtService.sign({ sub: 'user-1', tokenType: 'access' });

    const middleware = new GlobalRateLimitMiddleware(
      buildConfigService(true),
      jwtService,
      {} as never,
    );

    const consume = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ msBeforeNext: 2000 });

    (
      middleware as unknown as { burstLimiter: { consume: typeof consume } }
    ).burstLimiter = { consume };
    (
      middleware as unknown as { sustainedLimiter: { consume: typeof consume } }
    ).sustainedLimiter = { consume };

    const setHeader = jest.fn();
    const next = jest.fn();

    await expect(
      middleware.use(
        {
          headers: { authorization: `Bearer ${token}` },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as unknown as Request,
        { setHeader } as unknown as Response,
        next,
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(consume).toHaveBeenCalledWith('user:user-1', 1);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores spoofed x-forwarded-for and uses trusted req.ip', async () => {
    const middleware = new GlobalRateLimitMiddleware(
      buildConfigService(true),
      new JwtService({ secret: 'test-secret' }),
      {} as never,
    );

    const consume = jest.fn().mockResolvedValue({});

    (
      middleware as unknown as { burstLimiter: { consume: typeof consume } }
    ).burstLimiter = { consume };
    (
      middleware as unknown as { sustainedLimiter: { consume: typeof consume } }
    ).sustainedLimiter = { consume };

    const next = jest.fn();

    await middleware.use(
      {
        headers: { 'x-forwarded-for': '203.0.113.55' },
        ip: '10.0.0.8',
        socket: { remoteAddress: '10.0.0.8' },
      } as unknown as Request,
      { setHeader: jest.fn() } as unknown as Response,
      next,
    );

    expect(consume).toHaveBeenNthCalledWith(1, 'ip:10.0.0.8', 1);
    expect(next).toHaveBeenCalled();
  });
});
