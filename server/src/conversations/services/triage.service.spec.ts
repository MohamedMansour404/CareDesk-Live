import { TriageService } from './triage.service';
import { TriageLevel, MessagePriority } from '../../common/constants';
import { ConversationIntakeDto } from '../dto/create-conversation.dto';

describe('TriageService', () => {
  let service: TriageService;

  const baseIntake = (): ConversationIntakeDto => ({
    version: 1,
    demographics: {
      age: 30,
      gender: 'male',
    },
    clinical: {
      chronicConditions: [],
      symptomDuration: {
        value: 2,
        unit: 'days',
      },
      painScale: 3,
      mainComplaint: 'Mild headache with light fatigue',
    },
  });

  beforeEach(() => {
    service = new TriageService();
  });

  it('maps red-flag complaint to critical and high priority', () => {
    const intake = baseIntake();
    intake.clinical.mainComplaint =
      'I have severe chest pain and shortness of breath since morning';

    const result = service.assessIntake(intake);

    expect(result.level).toBe(TriageLevel.CRITICAL);
    expect(result.mappedPriority).toBe(MessagePriority.HIGH);
    expect(result.reasons.join(' ')).toContain('Red-flag');
  });

  it('adds age and chronic condition risk scores', () => {
    const intake = baseIntake();
    intake.demographics.age = 70;
    intake.clinical.chronicConditions = ['Diabetes', 'hypertension'];

    const result = service.assessIntake(intake);

    expect(result.score).toBeGreaterThan(30);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'Age risk band (<12 or >=65)',
        'Multiple chronic conditions',
        'High-risk chronic condition present',
      ]),
    );
  });

  it('deduplicates chronic conditions before scoring', () => {
    const intake = baseIntake();
    intake.clinical.chronicConditions = ['Diabetes', 'diabetes', ' DIABETES '];

    const result = service.assessIntake(intake);

    const chronicReasonCount = result.reasons.filter((reason) =>
      reason.includes('chronic condition'),
    ).length;
    expect(chronicReasonCount).toBe(2);
  });

  it('applies pain scale matrix correctly', () => {
    const intake = baseIntake();
    intake.clinical.painScale = 10;

    const result = service.assessIntake(intake);

    expect(result.reasons).toContain('Pain scale 9-10');
  });

  it('caps score at 100', () => {
    const intake = baseIntake();
    intake.demographics.age = 90;
    intake.clinical.chronicConditions = ['diabetes', 'hypertension', 'cancer'];
    intake.clinical.painScale = 10;
    intake.clinical.symptomDuration = { value: 12, unit: 'months' };
    intake.clinical.mainComplaint =
      'Severe chest pain, shortness of breath, and severe bleeding now';

    const result = service.assessIntake(intake);

    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('maps low score to low priority', () => {
    const intake = baseIntake();
    intake.demographics.age = 25;
    intake.clinical.painScale = 1;
    intake.clinical.symptomDuration = { value: 4, unit: 'hours' };
    intake.clinical.mainComplaint = 'I have mild cough and sore throat';

    const result = service.assessIntake(intake);

    expect(result.level).toBe(TriageLevel.LOW);
    expect(result.mappedPriority).toBe(MessagePriority.LOW);
  });
});
