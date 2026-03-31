import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { UsersModule } from '../users/users.module.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';

/**
 * Converts duration strings like '7d', '24h', '30m' to seconds.
 */
function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) return 604800; // default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd':
      return value * 86400;
    case 'h':
      return value * 3600;
    case 'm':
      return value * 60;
    case 's':
      return value;
    default:
      return 604800;
  }
}

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const expiration = configService.get<string>('jwt.expiration') ?? '7d';
        const secret = configService.get<string>('jwt.secret');
        if (!secret) {
          throw new Error('JWT secret is not configured');
        }
        const expiresInSeconds = parseDurationToSeconds(expiration);
        return {
          secret,
          signOptions: {
            expiresIn: expiresInSeconds,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AdminBootstrapService],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
