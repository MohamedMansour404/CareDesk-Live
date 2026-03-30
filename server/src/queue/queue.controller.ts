import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import {
  DlqJobDetailDto,
  DlqJobsResponseDto,
  DlqRetryResponseDto,
} from './dto/dlq.dto.js';

interface QueueServiceContract {
  getDlqJobs: (start?: number, end?: number) => Promise<DlqJobsResponseDto>;
  getDlqJob: (jobId: string) => Promise<DlqJobDetailDto>;
  retryDlqJob: (jobId: string) => Promise<DlqRetryResponseDto>;
}

@Controller('api/queue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AGENT)
export class QueueController {
  constructor(
    @Inject(QueueService)
    private readonly queueService: QueueServiceContract,
  ) {}

  @Get('dlq')
  async getDlq(
    @Query() pagination: PaginationDto,
  ): Promise<DlqJobsResponseDto> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const response: DlqJobsResponseDto = await this.queueService.getDlqJobs(
      start,
      end,
    );
    return response;
  }

  @Get('dlq/:jobId')
  async getDlqJob(@Param('jobId') jobId: string): Promise<DlqJobDetailDto> {
    const response: DlqJobDetailDto = await this.queueService.getDlqJob(jobId);
    return response;
  }

  @Post('dlq/:jobId/retry')
  async retryDlqJob(
    @Param('jobId') jobId: string,
  ): Promise<DlqRetryResponseDto> {
    const response: DlqRetryResponseDto =
      await this.queueService.retryDlqJob(jobId);
    return response;
  }
}
