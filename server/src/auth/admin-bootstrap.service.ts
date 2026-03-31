import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service.js';
import { UserRole } from '../common/constants.js';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled =
      this.configService.get<string>('ADMIN_BOOTSTRAP_ENABLED') === 'true';

    if (!enabled) {
      return;
    }

    const email =
      this.configService.get<string>('ADMIN_BOOTSTRAP_EMAIL')?.trim() ?? '';
    const password =
      this.configService.get<string>('ADMIN_BOOTSTRAP_PASSWORD')?.trim() ?? '';
    const name =
      this.configService.get<string>('ADMIN_BOOTSTRAP_NAME')?.trim() ??
      'System Administrator';
    const token =
      this.configService.get<string>('ADMIN_BOOTSTRAP_TOKEN')?.trim() ?? '';

    if (!email || !password || !token) {
      this.logger.warn(
        'Admin bootstrap is enabled but required variables are missing. Skipping admin bootstrap.',
      );
      return;
    }

    if (password.length < 12) {
      this.logger.error(
        'Admin bootstrap password must be at least 12 characters. Skipping admin bootstrap.',
      );
      return;
    }

    const existingAdminCount = await this.usersService.countByRole(
      UserRole.ADMIN,
    );
    if (existingAdminCount > 0) {
      this.logger.log(
        'Admin bootstrap skipped because an administrator account already exists.',
      );
      return;
    }

    await this.usersService.create({
      email,
      password,
      name,
      role: UserRole.ADMIN,
    });

    this.logger.log(
      `Bootstrap admin created for ${email}. Disable ADMIN_BOOTSTRAP_ENABLED after first run.`,
    );
  }
}
