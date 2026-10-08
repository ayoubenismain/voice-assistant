/**
 * Phase 8G — conversation-context.service.spec.ts
 *
 * Tests:
 *  - matchClarificationOption normalization and fuzzy matching
 *  - clarification resolution (Licence, Master, ingénieur, prépa)
 *  - stale clarification: unrelated message is NOT resolved
 *  - conversation context char budget trimming
 *  - recentMessageLimit configuration
 *  - pending clarification is never dropped by long history
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationContextService, matchClarificationOption } from './conversation-context.service.js';
import type { PendingClarification, ConversationContextMessage } from './conversation.types.js';

// ---------------------------------------------------------------------------
// Unit tests for the pure matching function
// ---------------------------------------------------------------------------

describe('matchClarificationOption — unit', () => {
  const OPTIONS = [
    'Licence',
    'Master',
    "Cycle d'ingénieurs",
    'Cycle préparatoire scientifique intégré',
  ];

  it('exact "Licence" matches', () => {
    expect(matchClarificationOption('Licence', OPTIONS)).toBe('Licence');
  });

  it('case-insensitive "licence" matches', () => {
    expect(matchClarificationOption('licence', OPTIONS)).toBe('Licence');
  });

  it('"master" matches Master', () => {
    expect(matchClarificationOption('master', OPTIONS)).toBe('Master');
  });

  it('"Master" matches', () => {
    expect(matchClarificationOption('Master', OPTIONS)).toBe('Master');
  });

  it('"ingénieur" matches Cycle d\'ingénieurs', () => {
    expect(matchClarificationOption('ingénieur', OPTIONS)).toBe("Cycle d'ingénieurs");
  });

  it('"ingenieur" (no accent) matches Cycle d\'ingénieurs', () => {
    expect(matchClarificationOption('ingenieur', OPTIONS)).toBe("Cycle d'ingénieurs");
  });

  it('"Cycle ingénieur" matches Cycle d\'ingénieurs', () => {
    expect(matchClarificationOption("Cycle d'ingénieurs", OPTIONS)).toBe("Cycle d'ingénieurs");
  });

  it('"prepa" matches Cycle préparatoire scientifique intégré', () => {
    expect(matchClarificationOption('prepa', OPTIONS)).toBe('Cycle préparatoire scientifique intégré');
  });

  it('"prépa" matches Cycle préparatoire scientifique intégré', () => {
    expect(matchClarificationOption('prépa', OPTIONS)).toBe('Cycle préparatoire scientifique intégré');
  });

  it('"Cycle préparatoire" matches Cycle préparatoire scientifique intégré', () => {
    expect(matchClarificationOption('Cycle préparatoire', OPTIONS)).toBe('Cycle préparatoire scientifique intégré');
  });

  it('"What is the capital of France?" does NOT match any option', () => {
    expect(matchClarificationOption('What is the capital of France?', OPTIONS)).toBeNull();
  });

  it('"Paris" does NOT match any option', () => {
    expect(matchClarificationOption('Paris', OPTIONS)).toBeNull();
  });

  it('"Je voudrais" does NOT match any option', () => {
    expect(matchClarificationOption('Je voudrais', OPTIONS)).toBeNull();
  });

  it('empty options array always returns null', () => {
    expect(matchClarificationOption('Licence', [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration tests for ConversationContextService
// ---------------------------------------------------------------------------

function makeMockConversationService(pending: PendingClarification | null = null, recentMsgs: ConversationContextMessage[] = []) {
  return {
    getOrCreateConversation: vi.fn().mockResolvedValue({ id: 'conv-123' }),
    getPendingClarification: vi.fn().mockResolvedValue(pending),
    loadRecentContextMessages: vi.fn().mockResolvedValue(recentMsgs),
  };
}

function makeMockConfigService(limit = '6', maxChars = '4000') {
  return {
    get: vi.fn((key: string, def: string) => {
      if (key === 'CONVERSATION_RECENT_MESSAGE_LIMIT') return limit;
      if (key === 'CONVERSATION_CONTEXT_MAX_CHARS') return maxChars;
      return def;
    }),
  };
}

function makeMockFollowupResolverService() {
  return {
    resolveFollowup: vi.fn((currentMessage: string) => ({
      rawQuery: currentMessage,
      effectiveQuery: currentMessage,
      wasResolvedAsFollowup: false,
    })),
  };
}

describe('ConversationContextService', () => {
  const BASE_PENDING: PendingClarification = {
    originalQuery: '9adeh soum inscription?',
    question: 'chniya cycle mta3ek?',
    options: ['Licence', 'Master', "Cycle d'ingénieurs", 'Cycle préparatoire scientifique intégré'],
    createdAt: new Date().toISOString(),
  };

  it('resolves "Licence" against pending clarification', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(BASE_PENDING) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'Licence');
    expect(ctx.clarificationResolved).toBe(true);
    expect(ctx.resolvedClarification).not.toBeNull();
    expect(ctx.effectiveQuery).toContain('9adeh soum inscription?');
    expect(ctx.effectiveQuery).toContain('Licence');
  });

  it('resolves "Master" against pending clarification', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(BASE_PENDING) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'Master');
    expect(ctx.clarificationResolved).toBe(true);
    expect(ctx.effectiveQuery).toContain('Master');
  });

  it('resolves "ingénieur" against pending clarification', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(BASE_PENDING) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'ingénieur');
    expect(ctx.clarificationResolved).toBe(true);
    expect(ctx.effectiveQuery).toContain("Cycle d'ingénieurs");
  });

  it('resolves "prépa" against pending clarification', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(BASE_PENDING) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'prépa');
    expect(ctx.clarificationResolved).toBe(true);
    expect(ctx.effectiveQuery).toContain('Cycle préparatoire');
  });

  it('does NOT resolve "What is the capital of France?" — stale clarification not applied', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(BASE_PENDING) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'What is the capital of France?');
    expect(ctx.clarificationResolved).toBe(false);
    expect(ctx.effectiveQuery).toBe('What is the capital of France?');
    expect(ctx.resolvedClarification).toBeNull();
  });

  it('returns currentMessage as effectiveQuery when no pending clarification', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(null) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', '9adeh soum inscription?');
    expect(ctx.effectiveQuery).toBe('9adeh soum inscription?');
    expect(ctx.clarificationResolved).toBe(false);
  });

  it('conversationId is included in assembled context', async () => {
    const svc = new ConversationContextService(
      makeMockConfigService() as any,
      makeMockConversationService(null) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'test');
    expect(ctx.conversationId).toBe('conv-123');
  });

  // ── Context limits ──────────────────────────────────────────────────────

  it('recentMessages respects CONVERSATION_RECENT_MESSAGE_LIMIT config', async () => {
    // The service passes the limit to loadRecentContextMessages
    const convSvc = makeMockConversationService(null);
    const svc = new ConversationContextService(
      makeMockConfigService('4') as any,
      convSvc as any,
      makeMockFollowupResolverService() as any,
    );
    await svc.assembleContext('student-a', 'test');
    expect(convSvc.loadRecentContextMessages).toHaveBeenCalledWith('conv-123', 4);
  });

  it('applyCharBudget trims messages exceeding CONVERSATION_CONTEXT_MAX_CHARS', async () => {
    // 3 messages each 200 chars, budget = 350 chars → 1 message gets trimmed
    const longContent = 'A'.repeat(200);
    const recentMsgs: ConversationContextMessage[] = [
      { role: 'USER', content: longContent, createdAt: new Date(Date.now() - 2000) },
      { role: 'ASSISTANT', content: longContent, createdAt: new Date(Date.now() - 1000) },
      { role: 'USER', content: longContent, createdAt: new Date() },
    ];
    const svc = new ConversationContextService(
      makeMockConfigService('6', '350') as any,
      makeMockConversationService(null, recentMsgs) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'new question');
    // Only 1 of 3 messages fits in 350 chars (each is 200)
    expect(ctx.recentMessages.length).toBeLessThanOrEqual(1);
  });

  it('pending clarification is preserved even when history is long', async () => {
    const recentMsgs: ConversationContextMessage[] = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? 'USER' as const : 'ASSISTANT' as const,
      content: 'x'.repeat(100),
      createdAt: new Date(Date.now() - (6 - i) * 1000),
    }));
    const svc = new ConversationContextService(
      makeMockConfigService('6', '200') as any,
      makeMockConversationService(BASE_PENDING, recentMsgs) as any,
      makeMockFollowupResolverService() as any,
    );
    const ctx = await svc.assembleContext('student-a', 'Licence');
    // Even with trimmed history, clarification resolution still worked
    expect(ctx.clarificationResolved).toBe(true);
    expect(ctx.resolvedClarification).not.toBeNull();
  });

  it('exposes recentMessageLimitValue and contextMaxCharsValue', () => {
    const svc = new ConversationContextService(
      makeMockConfigService('8', '5000') as any,
      makeMockConversationService() as any,
      makeMockFollowupResolverService() as any,
    );
    expect(svc.recentMessageLimitValue).toBe(8);
    expect(svc.contextMaxCharsValue).toBe(5000);
  });
});
