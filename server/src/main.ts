import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const corsOrigins = configService
    .get<string>('ws.corsOrigin', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim());
  const trustProxy = configService.get<boolean | number | string | string[]>(
    'security.trustProxy',
    false,
  );
  const httpServer = app.getHttpAdapter().getInstance() as {
    set?: (name: string, value: unknown) => void;
  };
  if (typeof httpServer.set === 'function') {
    httpServer.set('trust proxy', trustProxy);
  }

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(port);
  logger.log(`🚀 CareDesk AI server running on http://localhost:${port}`);
  logger.log(`📋 Environment: ${configService.get<string>('nodeEnv')}`);
  logger.log(`🔗 CORS Origins: ${corsOrigins.join(', ')}`);
  logger.log(`💚 Health check: http://localhost:${port}/api/health`);
}

void bootstrap();
