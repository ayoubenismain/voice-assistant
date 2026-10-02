import { DarijaNormalizerService } from './darija-normalizer.service.js';
import { RetrievalIntent } from './darija-normalizer.types.js';

describe('DarijaNormalizerService', () => {
  let service: DarijaNormalizerService;

  beforeEach(() => {
    service = new DarijaNormalizerService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty for empty query', () => {
    const res = service.normalize('   ');
    expect(res.originalQuery).toBe('');
    expect(res.normalizedQuery).toBe('');
  });

  it('should detect FEES and ACADEMIC_LEVEL for 9adeh inscription licence', () => {
    const res = service.normalize('9adeh inscription licence?');
    expect(res.detectedIntents).toContain(RetrievalIntent.FEES);
    expect(res.detectedIntents).toContain(RetrievalIntent.GENERAL_REGISTRATION);
    expect(res.detectedIntents).toContain(RetrievalIntent.ACADEMIC_LEVEL);
    expect(res.normalizedQuery).toContain('frais');
    expect(res.normalizedQuery).toContain('montant');
    expect(res.normalizedQuery).toContain('licence');
    expect(res.normalizedQuery).toContain('inscription');
  });

  it('should detect DATES for wa9tech', () => {
    const res = service.normalize('wa9tech inscription?');
    expect(res.detectedIntents).toContain(RetrievalIntent.DATES);
    expect(res.normalizedQuery).toContain('calendrier');
  });

  it('should detect DOCUMENTS for chnouma lwra9', () => {
    const res = service.normalize('chnouma lwra9 mta3 inscription?');
    expect(res.detectedIntents).toContain(RetrievalIntent.DOCUMENTS);
    expect(res.normalizedQuery).toContain('pièces');
  });

  it('should handle multi-intent queries like 9adeh inscription w wa9tech n9ayed', () => {
    const res = service.normalize('9adeh inscription licence w wa9tech n9ayed');
    expect(res.detectedIntents).toContain(RetrievalIntent.FEES);
    expect(res.detectedIntents).toContain(RetrievalIntent.DATES);
    expect(res.detectedIntents).toContain(RetrievalIntent.GENERAL_REGISTRATION);
  });

  it('should preserve French words that do not match lexicon', () => {
    const res = service.normalize('9adeh paiement master?');
    expect(res.normalizedQuery).toContain('paiement');
    expect(res.normalizedQuery).toContain('master');
  });
});
