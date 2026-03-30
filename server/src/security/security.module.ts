import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GlobalRateLimitMiddleware } from './global-rate-limit.middleware.js';

@Module({
  imports: [AuthModule],
  providers: [GlobalRateLimitMiddleware],
  exports: [GlobalRateLimitMiddleware],
})
export class SecurityModule {}
