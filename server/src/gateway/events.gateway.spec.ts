import { EventsGateway } from './events.gateway';

describe('EventsGateway origin hardening', () => {
  it('enforces allowRequest origin allowlist', () => {
    const gateway = new EventsGateway(
      { verify: jest.fn() } as never,
      { assertCanAccess: jest.fn() } as never,
      {
        get: jest.fn((key: string) =>
          key === 'ws.corsOrigin'
            ? 'https://app.example.com,https://ops.example.com'
            : undefined,
        ),
      } as never,
      null,
    );

    const fakeServer = {
      engine: {
        opts: {},
        on: jest.fn(),
      },
    } as never;

    gateway.afterInit(fakeServer);

    const allowRequest = (
      fakeServer as unknown as {
        engine: {
          opts: {
            allowRequest: (
              req: { headers?: { origin?: string } },
              callback: (error: string | null, success: boolean) => void,
            ) => void;
          };
        };
      }
    ).engine.opts.allowRequest;

    const denied = jest.fn();
    allowRequest({ headers: { origin: 'https://evil.example.com' } }, denied);
    expect(denied).toHaveBeenCalledWith('origin not allowed', false);

    const allowed = jest.fn();
    allowRequest({ headers: { origin: 'https://app.example.com' } }, allowed);
    expect(allowed).toHaveBeenCalledWith(null, true);
  });
});
