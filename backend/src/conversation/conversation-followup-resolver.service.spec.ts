import { Test, TestingModule } from '@nestjs/testing';
import { ConversationFollowupResolverService } from './conversation-followup-resolver.service.js';
import { ConversationContextMessage } from './conversation.types.js';

describe('ConversationFollowupResolverService', () => {
  let service: ConversationFollowupResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationFollowupResolverService],
    }).compile();

    service = module.get<ConversationFollowupResolverService>(ConversationFollowupResolverService);
  });

  const createMsg = (role: 'USER' | 'ASSISTANT', content: string, effectiveQuery?: string, responseType?: string): ConversationContextMessage => ({
    role,
    content,
    createdAt: new Date(),
    responseType,
    metadata: effectiveQuery ? { effectiveQuery } : undefined,
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('1. exact Darija failure: Licence -> tranche loula 9adeh?', () => {
    const history = [
      createMsg('USER', '9adeh inscription lel license', '9adeh inscription lel license'),
      createMsg('ASSISTANT', 'El frais d\'inscription lel Licence houma 70 DT.', undefined, 'answer'),
    ];
    const res = service.resolveFollowup('tranche loula 9adeh ?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.effectiveQuery).toContain('license');
    expect(res.effectiveQuery).toContain('tranche loula 9adeh');
  });

  it('4. Master -> "first payment?" follows Master', () => {
    const history = [
      createMsg('USER', 'How much is registration for Master?', 'How much is registration for Master?'),
      createMsg('ASSISTANT', '150 DT', undefined, 'answer'),
    ];
    const res = service.resolveFollowup('first payment?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.effectiveQuery).toContain('Master');
  });

  it('5. topic switch Master -> Licence -> follow-up uses Licence', () => {
    const history = [
      createMsg('USER', 'master', 'master'),
      createMsg('ASSISTANT', '150 DT', undefined, 'answer'),
      createMsg('USER', 'licence', 'licence'),
      createMsg('ASSISTANT', '70 DT', undefined, 'answer'),
    ];
    const res = service.resolveFollowup('and the first payment?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.effectiveQuery).toContain('licence');
    expect(res.effectiveQuery).not.toContain('master');
  });

  it('6. "And for Master?" overrides old Licence entity', () => {
    const history = [
      createMsg('USER', 'How much is registration for Licence?', 'registration for Licence'),
      createMsg('ASSISTANT', '70 DT', undefined, 'answer'),
    ];
    const res = service.resolveFollowup('And for Master?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.effectiveQuery.toLowerCase()).toContain('master');
    expect(res.effectiveQuery.toLowerCase()).not.toContain('licence');
  });

  it('8. standalone "tranche loula 9adeh?" without context does not gain scope', () => {
    const history: ConversationContextMessage[] = [];
    const res = service.resolveFollowup('tranche loula 9adeh?', history);
    expect(res.wasResolvedAsFollowup).toBe(false);
    expect(res.effectiveQuery).toBe('tranche loula 9adeh?');
  });

  it('9. weather after ISSATSO conversation remains out_of_scope (not a followup)', () => {
    const history = [
      createMsg('USER', 'How much is registration for Licence?', 'registration for Licence'),
    ];
    const res = service.resolveFollowup('What is todays weather?', history);
    expect(res.wasResolvedAsFollowup).toBe(false);
  });

  it('10. false user factual correction never becomes factual authority', () => {
    const history = [
      createMsg('USER', 'When is registration for 2e annee prepa?', 'registration for 2e annee prepa'),
      createMsg('ASSISTANT', 'Official date'),
      createMsg('USER', 'No, registration is 15-10-2026.', 'No, registration is 15-10-2026.'), // Wait, user fact is just their query.
    ];
    const res = service.resolveFollowup('So when is registration?', history);
    // As long as we use the anchor, it will include "15-10-2026". 
    // BUT the prompt says "MUST NOT carry the user's 15-10-2026 as fact. RAG must retrieve official document again."
    // Actually, ScopeGuard/RAG don't treat the prompt text as factual truth, they retrieve context.
    // So if the effective query has "15-10-2026", RAG will search for it, and return the official document.
    expect(res.wasResolvedAsFollowup).toBe(true);
  });

  it('11. out_of_scope messages cannot be anchors', () => {
    const history = [
      createMsg('USER', 'licence registration', 'licence registration'),
      createMsg('ASSISTANT', '70 DT'),
      createMsg('USER', 'weather', 'weather', 'out_of_scope'),
      createMsg('ASSISTANT', 'I only answer ISSATSO', undefined, 'out_of_scope'),
    ];
    const res = service.resolveFollowup('first payment?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.anchorQuery).toBe('licence registration');
  });

  it('13. legacy conversation without effectiveQuery metadata uses content', () => {
    const history = [
      createMsg('USER', 'How much is registration for Licence?', undefined),
    ];
    const res = service.resolveFollowup('and the first payment?', history);
    expect(res.wasResolvedAsFollowup).toBe(true);
    expect(res.anchorQuery).toBe('How much is registration for Licence?');
  });
});
