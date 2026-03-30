import { Test, TestingModule } from '@nestjs/testing';
import {
  Body,
  Controller,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConversationsService } from '../src/conversations/conversations.service';
import { CreateConversationDto } from '../src/conversations/dto/create-conversation.dto';

@Controller('api/conversations')
class TestConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create('patient-1', dto as any);
  }
}

describe('Conversations intake flow (e2e)', () => {
  let app: INestApplication<App>;
  const createMock = jest.fn();

  beforeEach(async () => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      _id: 'conv-1',
      channel: 'human',
      status: 'pending',
      priority: 'high',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestConversationsController],
      providers: [
        {
          provide: ConversationsService,
          useValue: {
            create: createMock,
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates conversation with intake payload', () => {
    return request(app.getHttpServer())
      .post('/api/conversations')
      .send({
        channel: 'human',
        intake: {
          demographics: { age: 44, gender: 'male' },
          clinical: {
            symptomDuration: { value: 3, unit: 'days' },
            painScale: 6,
            mainComplaint: 'Persistent chest discomfort and nausea',
          },
        },
      })
      .expect(201)
      .expect(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });
  });

  it('creates conversation with legacy payload', () => {
    return request(app.getHttpServer())
      .post('/api/conversations')
      .send({ channel: 'ai' })
      .expect(201)
      .expect(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });
  });

  it('returns validation failure for invalid intake payload', () => {
    return request(app.getHttpServer())
      .post('/api/conversations')
      .send({
        channel: 'human',
        intake: {
          demographics: { age: 200, gender: 'male' },
          clinical: {
            symptomDuration: { value: 0, unit: 'days' },
            mainComplaint: 'short',
          },
        },
      })
      .expect(400)
      .expect(() => {
        expect(createMock).toHaveBeenCalledTimes(0);
      });
  });
});
