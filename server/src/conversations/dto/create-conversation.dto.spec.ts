import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateConversationDto } from './create-conversation.dto';

describe('CreateConversationDto validation', () => {
  const validPayload = {
    channel: 'human',
    intake: {
      version: 1,
      demographics: {
        age: 40,
        gender: 'female',
      },
      vitals: {
        heightCm: 168,
        weightKg: 64,
      },
      clinical: {
        chronicConditions: ['diabetes'],
        symptomDuration: {
          value: 3,
          unit: 'days',
        },
        painScale: 5,
        mainComplaint: 'Persistent headache and nausea for two days',
      },
    },
  };

  it('accepts valid intake payload', async () => {
    const dto = plainToInstance(CreateConversationDto, validPayload);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts legacy payload without intake', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      channel: 'ai',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid pain scale', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      ...validPayload,
      intake: {
        ...validPayload.intake,
        clinical: {
          ...validPayload.intake.clinical,
          painScale: 11,
        },
      },
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid symptom duration unit', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      ...validPayload,
      intake: {
        ...validPayload.intake,
        clinical: {
          ...validPayload.intake.clinical,
          symptomDuration: {
            value: 2,
            unit: 'years',
          },
        },
      },
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects short main complaint', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      ...validPayload,
      intake: {
        ...validPayload.intake,
        clinical: {
          ...validPayload.intake.clinical,
          mainComplaint: 'Too short',
        },
      },
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
