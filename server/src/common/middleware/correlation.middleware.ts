import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Correlation ID Middleware
 *
 * Generates a unique correlationId for every HTTP request and attaches it
 * to the request object + response header. This ID is then propagated
 * through events, queue jobs, and WebSocket emissions for full traceability.
 *
 * Flow: HTTP Request → req.correlationId → Event → Queue Job → WebSocket
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Use incoming header if present (for upstream service chaining), else generate
    const correlationId =
      (req.headers['x-correlation-id'] as string) || randomUUID();

    // Attach to request for downstream usage
    (req as unknown as CorrelatedRequest).correlationId = correlationId;
    (req as unknown as CorrelatedRequest).userId =
      (req as unknown as { user?: { userId?: string } }).user?.userId;

    // Set response header for client-side debugging
    _res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}

/**
 * Extended Express Request with correlation context.
 */
export interface CorrelatedRequest extends Request {
  correlationId: string;
  userId?: string;
}
