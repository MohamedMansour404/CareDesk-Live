import { HealthController } from './health.controller';

describe('HealthController readiness', () => {
  it('uses strict readiness checks including redis ready, queue and websocket', async () => {
    const check = jest.fn(async (callbacks: Array<() => unknown>) => {
      await Promise.all(callbacks.map((cb) => cb()));
      return { status: 'ok' };
    });

    const controller = new HealthController(
      { check } as never,
      {
        pingCheck: jest.fn().mockResolvedValue({ mongodb: { status: 'up' } }),
      } as never,
      {
        isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
        isReady: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
      } as never,
      {
        isHealthy: jest.fn().mockResolvedValue({ queue: { status: 'up' } }),
      } as never,
      {
        isHealthy: jest.fn().mockReturnValue({ websocket: { status: 'up' } }),
      } as never,
    );

    await controller.readiness();

    expect(check).toHaveBeenCalledTimes(1);
    const redis = (controller as never).redis as { isReady: jest.Mock };
    expect(redis.isReady).toHaveBeenCalledWith('redis');
  });
});
