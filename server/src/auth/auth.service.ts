import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload } from './strategies/jwt.strategy.js';
import { UserDocument } from '../users/schemas/user.schema.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { UserRole } from '../common/constants.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(createUserDto: CreateUserDto) {
    const normalizedDto: CreateUserDto = {
      ...createUserDto,
      role: UserRole.PATIENT,
    };

    const user = await this.usersService.create(normalizedDto);
    const tokens = this.generateTokens(user);
    await this.setRefreshTokenHash(user._id.toString(), tokens.refreshToken);

    this.logger.log(`User registered: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.validatePassword(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = this.generateTokens(user);
    await this.setRefreshTokenHash(user._id.toString(), tokens.refreshToken);
    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async refresh(refreshTokenDto: RefreshTokenDto) {
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify<JwtPayload>(
        refreshTokenDto.refreshToken,
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token type');
    }

    const user = await this.usersService.findByIdWithCredentials(payload.sub);

    if (!user.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    const isMatch = await bcrypt.compare(
      refreshTokenDto.refreshToken,
      user.refreshTokenHash,
    );

    if (!isMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = this.generateTokens(user);
    await this.setRefreshTokenHash(user._id.toString(), tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    await this.usersService.setRefreshTokenHash(userId, null);
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    return this.sanitizeUser(user);
  }

  private generateTokens(user: UserDocument): {
    accessToken: string;
    refreshToken: string;
  } {
    const basePayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign({
      ...basePayload,
      tokenType: 'access',
    });

    const refreshTokenExpiration =
      this.configService.get<string>('jwt.refreshExpiration') ?? '30d';
    const refreshExpiresInSeconds = this.parseDurationToSeconds(
      refreshTokenExpiration,
    );
    const refreshToken = this.jwtService.sign(
      {
        ...basePayload,
        tokenType: 'refresh',
      },
      {
        expiresIn: refreshExpiresInSeconds,
      },
    );

    return { accessToken, refreshToken };
  }

  private async setRefreshTokenHash(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.usersService.setRefreshTokenHash(userId, refreshTokenHash);
  }

  private parseDurationToSeconds(duration: string): number {
    const match = duration.match(/^(\d+)([dhms])$/);
    if (!match) return 30 * 24 * 60 * 60;

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
        return 30 * 24 * 60 * 60;
    }
  }

  private sanitizeUser(user: UserDocument) {
    const obj = user.toObject();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshTokenHash, ...sanitized } = obj;
    return sanitized;
  }
}
