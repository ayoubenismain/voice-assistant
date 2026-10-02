import { Test, TestingModule } from '@nestjs/testing';
import { DarijaNormalizerService } from './darija/darija-normalizer.service';
import { RetrievalIntent } from './darija/darija-normalizer.types';

describe('English Intents Detection', () => {
  let service: DarijaNormalizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DarijaNormalizerService],
    }).compile();

    service = module.get<DarijaNormalizerService>(DarijaNormalizerService);
  });

  describe('SUFFICIENCY', () => {
    const sufficiencyQueries = [
      "Is online registration alone enough?",
      "Is this enough by itself?",
      "Is this sufficient?",
      "Does this alone suffice?"
    ];

    it.each(sufficiencyQueries)('should detect SUFFICIENCY for "%s"', (query) => {
      const result = service.normalize(query);
      expect(result.detectedIntents).toContain(RetrievalIntent.SUFFICIENCY);
      expect(result.expansionApplied).toBe(false);
    });
  });

  describe('FULL PAYMENT', () => {
    const fullPaymentQueries = [
      "Can I pay all registration fees at once?",
      "Can I pay everything at once?",
      "Can I pay the full amount in one payment?",
      "Can I pay the whole amount in one go?"
    ];

    it.each(fullPaymentQueries)('should detect FULL_PAYMENT for "%s"', (query) => {
      const result = service.normalize(query);
      expect(result.detectedIntents).toContain(RetrievalIntent.FULL_PAYMENT);
      expect(result.detectedIntents).toContain(RetrievalIntent.PAYMENT_RULES);
      expect(result.expansionApplied).toBe(false);
    });
  });

  describe('Unrelated queries', () => {
    it('should detect only FEES for "How much are registration fees?"', () => {
      const result = service.normalize("How much are registration fees?");
      expect(result.detectedIntents).not.toContain(RetrievalIntent.SUFFICIENCY);
      expect(result.detectedIntents).not.toContain(RetrievalIntent.FULL_PAYMENT);
    });

    it('should detect only DATES for "When is registration?"', () => {
      const result = service.normalize("When is registration?");
      expect(result.detectedIntents).not.toContain(RetrievalIntent.SUFFICIENCY);
      expect(result.detectedIntents).not.toContain(RetrievalIntent.FULL_PAYMENT);
    });

    it('should detect only WEBSITE for "What is the registration website?"', () => {
      const result = service.normalize("What is the registration website?");
      expect(result.detectedIntents).not.toContain(RetrievalIntent.SUFFICIENCY);
      expect(result.detectedIntents).not.toContain(RetrievalIntent.FULL_PAYMENT);
    });
  });
});
