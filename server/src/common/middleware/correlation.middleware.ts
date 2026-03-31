import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Adds a correlation ID to request context and response headers.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Reuse inbound ID when available for cross-service tracing.
    const correlationId =
      (req.headers['x-correlation-id'] as string) || randomUUID();

    (req as unknown as CorrelatedRequest).correlationId = correlationId;
    (req as unknown as CorrelatedRequest).userId = (
      req as unknown as { user?: { userId?: string } }
    ).user?.userId;

    _res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}

/** Request type enriched by CorrelationMiddleware. */
export interface CorrelatedRequest extends Request {
  correlationId: string;
  userId?: string;
}
