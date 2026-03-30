import { Injectable } from '@nestjs/common';
import {
  MessagePriority,
  TriageLevel,
  TriageSource,
} from '../../common/constants.js';
import { ConversationIntakeDto } from '../dto/create-conversation.dto.js';

export interface TriageResult {
  level: TriageLevel;
  score: number;
  source: TriageSource;
  reasons: string[];
  classifiedAt: Date;
  mappedPriority: MessagePriority;
}

@Injectable()
export class TriageService {
  private readonly highRiskConditions = new Set([
    'diabetes',
    'hypertension',
    'heart disease',
    'heart_disease',
    'asthma',
    'ckd',
    'chronic kidney disease',
    'cancer',
  ]);

  private readonly redFlagKeywords = [
    'chest pain',
    'shortness of breath',
    'stroke',
    'seizure',
    'unconscious',
    'severe bleeding',
    'suicidal',
  ];

  private readonly urgentKeywords = [
    'persistent fever',
    'severe vomiting',
    'dehydration',
    'infection',
    'uncontrolled pain',
  ];

  assessIntake(intake: ConversationIntakeDto): TriageResult {
    const reasons: string[] = [];
    let score = 0;

    const age = intake.demographics.age;
    if (age < 12 || age >= 65) {
      score += 15;
      reasons.push('Age risk band (<12 or >=65)');
    } else if (age >= 45) {
      score += 8;
      reasons.push('Age risk band (45-64)');
    }

    const normalizedConditions = this.normalizeConditions(
      intake.clinical.chronicConditions ?? [],
    );

    if (normalizedConditions.length === 1) {
      score += 8;
      reasons.push('One chronic condition');
    } else if (normalizedConditions.length >= 2) {
      score += 15;
      reasons.push('Multiple chronic conditions');
    }

    if (this.hasHighRiskCondition(normalizedConditions)) {
      score += 5;
      reasons.push('High-risk chronic condition present');
    }

    const complaint = this.normalizeText(intake.clinical.mainComplaint);

    const redFlagHit = this.redFlagKeywords.some((keyword) =>
      complaint.includes(keyword),
    );
    const urgentHit = this.urgentKeywords.some((keyword) =>
      complaint.includes(keyword),
    );

    if (redFlagHit) {
      score += 40;
      reasons.push('Red-flag complaint keyword detected');
    } else if (urgentHit) {
      score += 20;
      reasons.push('Urgent complaint keyword detected');
    } else {
      score += 5;
      reasons.push('General complaint keyword group');
    }

    const pain = intake.clinical.painScale;
    if (pain >= 9) {
      score += 30;
      reasons.push('Pain scale 9-10');
    } else if (pain >= 7) {
      score += 20;
      reasons.push('Pain scale 7-8');
    } else if (pain >= 4) {
      score += 10;
      reasons.push('Pain scale 4-6');
    }

    const durationHours = this.toHours(
      intake.clinical.symptomDuration.value,
      intake.clinical.symptomDuration.unit,
    );
    if (durationHours <= 24) {
      score += 5;
      reasons.push('Symptom duration <= 24h');
    } else if (durationHours <= 24 * 7) {
      score += 10;
      reasons.push('Symptom duration 2-7 days');
    } else {
      score += 15;
      reasons.push('Symptom duration > 7 days');
    }

    score = Math.max(0, Math.min(100, score));

    let level = this.resolveLevel(score);
    if (redFlagHit && level !== TriageLevel.CRITICAL) {
      level = TriageLevel.CRITICAL;
      reasons.push('Critical override due to red-flag keyword');
    }

    return {
      level,
      score,
      source: TriageSource.RULES_V1,
      reasons,
      classifiedAt: new Date(),
      mappedPriority: this.mapLevelToPriority(level),
    };
  }

  private resolveLevel(score: number): TriageLevel {
    if (score >= 70) return TriageLevel.CRITICAL;
    if (score >= 45) return TriageLevel.HIGH;
    if (score >= 20) return TriageLevel.MEDIUM;
    return TriageLevel.LOW;
  }

  private mapLevelToPriority(level: TriageLevel): MessagePriority {
    switch (level) {
      case TriageLevel.CRITICAL:
      case TriageLevel.HIGH:
        return MessagePriority.HIGH;
      case TriageLevel.MEDIUM:
        return MessagePriority.MEDIUM;
      default:
        return MessagePriority.LOW;
    }
  }

  private normalizeConditions(conditions: string[]): string[] {
    const unique = new Set(
      conditions
        .map((condition) => this.normalizeText(condition))
        .filter((condition) => condition.length > 0),
    );
    return [...unique];
  }

  private hasHighRiskCondition(conditions: string[]): boolean {
    return conditions.some((condition) =>
      this.highRiskConditions.has(condition),
    );
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toHours(
    value: number,
    unit: 'hours' | 'days' | 'weeks' | 'months',
  ): number {
    switch (unit) {
      case 'hours':
        return value;
      case 'days':
        return value * 24;
      case 'weeks':
        return value * 24 * 7;
      case 'months':
        return value * 24 * 30;
      default:
        return value;
    }
  }
}
