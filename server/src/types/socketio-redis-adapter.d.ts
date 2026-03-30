declare module '@socket.io/redis-adapter' {
  import type Redis from 'ioredis';
  import type { Server } from 'socket.io';

  export function createAdapter(
    pubClient: Redis,
    subClient: Redis,
  ): Parameters<Server['adapter']>[0];
}
