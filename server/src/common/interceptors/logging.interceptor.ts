import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { logWithContext } from '../utils/log-with-context.js';

type InterceptorRequest = {
  method?: string;
  url?: string;
  correlationId?: string;
  user?: { userId?: string };
};

type InterceptorResponse = {
  statusCode?: number;
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<InterceptorRequest>();
    const method = request.method ?? 'UNKNOWN';
    const url = request.url ?? 'UNKNOWN';
    const correlationId = request.correlationId;
    const userId = request.user?.userId;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context
          .switchToHttp()
          .getResponse<InterceptorResponse>();
        const statusCode = response.statusCode ?? 200;
        const duration = Date.now() - now;

        logWithContext(this.logger, 'log', `${method} ${url} ${statusCode}`, {
          correlationId,
          userId,
          duration,
        });
      }),
    );
  }
}
