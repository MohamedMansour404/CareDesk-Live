import { Logger } from '@nestjs/common';

/** Structured metadata for contextual logs. */
export interface LogContext {
  correlationId?: string;
  conversationId?: string;
  messageId?: string;
  userId?: string;
  jobId?: string | number;
  channel?: string;
  duration?: number;
  [key: string]: unknown;
}

/** Format context values into a compact log suffix. */
function formatContext(ctx: LogContext): string {
  const parts: string[] = [];

  const stringifyValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value === null) return 'null';
    if (value instanceof Date) return value.toISOString();

    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  };

  if (ctx.correlationId) parts.push(`cid=${ctx.correlationId.slice(0, 8)}`);
  if (ctx.conversationId) parts.push(`conv=${ctx.conversationId.slice(-6)}`);
  if (ctx.messageId) parts.push(`msg=${ctx.messageId.slice(-6)}`);
  if (ctx.userId) parts.push(`user=${ctx.userId.slice(-6)}`);
  if (ctx.jobId) parts.push(`job=${ctx.jobId}`);
  if (ctx.channel) parts.push(`ch=${ctx.channel}`);
  if (ctx.duration !== undefined) parts.push(`${ctx.duration}ms`);

  // Include custom keys that are not part of the standard context fields.
  for (const [key, value] of Object.entries(ctx)) {
    if (
      ![
        'correlationId',
        'conversationId',
        'messageId',
        'userId',
        'jobId',
        'channel',
        'duration',
      ].includes(key) &&
      value !== undefined
    ) {
      parts.push(`${key}=${stringifyValue(value)}`);
    }
  }

  return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
}

/** Log with contextual suffix using Nest Logger methods. */
export function logWithContext(
  logger: Logger,
  level: 'log' | 'warn' | 'error' | 'debug',
  message: string,
  ctx: LogContext = {},
): void {
  const suffix = formatContext(ctx);
  logger[level](`${message}${suffix}`);
}
