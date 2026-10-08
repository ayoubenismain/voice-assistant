/**
 * Phase 8G — conversation.service.spec.ts
 *
 * Tests:
 *  1. get/create one conversation per user (idempotent)
 *  2. save and load messages
 *  3. pending clarification persistence (set/get/clear)
 *  4. user isolation (student-a != student-b)
 *  5. conversation reset
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ConversationService } from './conversation.service.js';

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

function makePrismaStub() {
  const conversations: Map<string, any> = new Map();
  const messages: any[] = [];
  let idCounter = 0;

  function nextId() { return `id-${++idCounter}`; }

  return {
    conversation: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return conversations.get(where.id) ?? null;
        if (where.userId) {
          for (const c of conversations.values()) {
            if (c.userId === where.userId) return c;
          }
          return null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = nextId();
        const conv = { id, userId: data.userId, pendingClarification: null, messages: [] };
        conversations.set(id, conv);
        return conv;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const conv = conversations.get(where.id);
        if (!conv) throw new Error('Not found');
        if ('pendingClarification' in data) {
          // Coerce Prisma.JsonNull sentinel to actual null for test assertions
          const val = data.pendingClarification;
          conv.pendingClarification = (val === Prisma.JsonNull) ? null : (val ?? null);
        }
        return conv;
      }),
    },
    conversationMessage: {
      findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
        let rows = messages.filter(m => m.conversationId === where.conversationId);
        // Sort by createdAt desc (newest first) — matching Prisma orderBy: { createdAt: 'desc' }
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (take) rows = rows.slice(0, take);
        return rows;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = nextId();
        // Ensure monotonically increasing timestamps so insertion order is preserved
        const ts = new Date(Date.now() + messages.length);
        const msg = { id, ...data, createdAt: ts };
        messages.push(msg);
        return msg;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = messages.length;
        const toRemove = messages.filter(m => m.conversationId === where.conversationId).map(m => m.id);
        toRemove.forEach(id => {
          const idx = messages.findIndex(m => m.id === id);
          if (idx !== -1) messages.splice(idx, 1);
        });
        return { count: before - messages.length };
      }),
    },
    $transaction: vi.fn(async (ops: any[]) => {
      const results: any[] = [];
      for (const op of ops) results.push(await op);
      return results;
    }),
    // Expose internal state for assertions
    _conversations: conversations,
    _messages: messages,
  };
}

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prisma = makePrismaStub();
    service = new ConversationService(prisma as any);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: get or create — idempotent
  // ──────────────────────────────────────────────────────────────────────────

  it('1. getOrCreateConversation creates a new conversation for a new userId', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    expect(conv.id).toBeDefined();
    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
  });

  it('1b. getOrCreateConversation returns the existing conversation on second call', async () => {
    const first = await service.getOrCreateConversation('student-a');
    const second = await service.getOrCreateConversation('student-a');
    expect(first.id).toBe(second.id);
    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
  });

  it('1c. different userIds get different conversations', async () => {
    const a = await service.getOrCreateConversation('student-a');
    const b = await service.getOrCreateConversation('student-b');
    expect(a.id).not.toBe(b.id);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: save and load messages
  // ──────────────────────────────────────────────────────────────────────────

  it('2. saveExchange persists user and assistant messages', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    await service.saveExchange(conv.id, 'user says', 'assistant says', 'answer');
    const msgs = await service.loadRecentMessages(conv.id, 10);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('USER');
    expect(msgs[1].role).toBe('ASSISTANT');
    expect(msgs[1].responseType).toBe('answer');
  });

  it('2b. loadRecentMessages respects the limit', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    for (let i = 0; i < 5; i++) {
      await service.saveExchange(conv.id, `user ${i}`, `asst ${i}`, 'answer');
    }
    const msgs = await service.loadRecentMessages(conv.id, 4);
    expect(msgs.length).toBeLessThanOrEqual(4);
  });

  it('2c. loadRecentMessages returns empty array when no messages', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    const msgs = await service.loadRecentMessages(conv.id, 6);
    expect(msgs).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: pending clarification
  // ──────────────────────────────────────────────────────────────────────────

  it('3. getPendingClarification returns null when not set', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    const pending = await service.getPendingClarification(conv.id);
    expect(pending).toBeNull();
  });

  it('3b. setPendingClarification persists and getPendingClarification returns it', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    const state = {
      originalQuery: '9adeh soum inscription?',
      question: 'chniya cycle mta3ek?',
      options: ['Licence', 'Master', "Cycle d'ingénieurs", 'Cycle préparatoire scientifique intégré'],
      createdAt: new Date().toISOString(),
    };
    await service.setPendingClarification(conv.id, state);
    const pending = await service.getPendingClarification(conv.id);
    expect(pending).not.toBeNull();
    expect(pending!.originalQuery).toBe('9adeh soum inscription?');
    expect(pending!.options).toHaveLength(4);
  });

  it('3c. clearPendingClarification sets it back to null', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    await service.setPendingClarification(conv.id, {
      originalQuery: 'test',
      question: 'q?',
      options: ['A', 'B'],
      createdAt: new Date().toISOString(),
    });
    await service.clearPendingClarification(conv.id);
    const pending = await service.getPendingClarification(conv.id);
    expect(pending).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: user isolation
  // ──────────────────────────────────────────────────────────────────────────

  it('4. user isolation — student-b cannot see student-a pending clarification', async () => {
    const convA = await service.getOrCreateConversation('student-a');
    await service.setPendingClarification(convA.id, {
      originalQuery: '9adeh soum inscription?',
      question: 'chniya cycle mta3ek?',
      options: ['Licence', 'Master'],
      createdAt: new Date().toISOString(),
    });

    const convB = await service.getOrCreateConversation('student-b');
    const pendingB = await service.getPendingClarification(convB.id);
    expect(pendingB).toBeNull();
  });

  it('4b. user isolation — messages are separate', async () => {
    const convA = await service.getOrCreateConversation('student-a');
    const convB = await service.getOrCreateConversation('student-b');

    await service.saveExchange(convA.id, 'A message', 'A reply', 'answer');

    const msgsB = await service.loadRecentMessages(convB.id, 10);
    expect(msgsB).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: reset conversation
  // ──────────────────────────────────────────────────────────────────────────

  it('5. resetConversation clears all messages and pending clarification', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    await service.saveExchange(conv.id, 'user', 'asst', 'answer');
    await service.setPendingClarification(conv.id, {
      originalQuery: 'test',
      question: 'q?',
      options: ['A'],
      createdAt: new Date().toISOString(),
    });

    await service.resetConversation('student-a');

    const msgs = await service.loadRecentMessages(conv.id, 10);
    const pending = await service.getPendingClarification(conv.id);

    expect(msgs).toHaveLength(0);
    expect(pending).toBeNull();
  });

  it('5b. resetConversation on non-existent userId does nothing gracefully', async () => {
    await expect(service.resetConversation('nobody')).resolves.not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: out_of_scope filtering (Phase 8G.1)
  // ──────────────────────────────────────────────────────────────────────────

  it('6a. saveExchange sets responseType on both USER and ASSISTANT', async () => {
    const conv = await service.getOrCreateConversation('student-a');
    await service.saveExchange(conv.id, 'What is the weather?', 'I only help with ISSATSO.', 'out_of_scope');
    const msgs = await service.loadRecentMessages(conv.id, 10);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('USER');
    expect(msgs[0].responseType).toBe('out_of_scope');
    expect(msgs[1].role).toBe('ASSISTANT');
    expect(msgs[1].responseType).toBe('out_of_scope');
  });

  it('6b. loadRecentContextMessages excludes out_of_scope exchanges (both user and assistant)', async () => {
    const conv = await service.getOrCreateConversation('student-context');
    // Save valid exchange
    await service.saveExchange(conv.id, 'Q1', 'A1', 'answer');
    // Save out_of_scope exchange
    await service.saveExchange(conv.id, 'Q2_Weather', 'A2_Weather', 'out_of_scope');
    // Save another valid exchange
    await service.saveExchange(conv.id, 'Q3', 'A3', 'clarification');

    const fullHistory = await service.loadRecentMessages(conv.id, 10);
    expect(fullHistory).toHaveLength(6);

    const contextMsgs = await service.loadRecentContextMessages(conv.id, 10);
    // Should exclude the 2 out_of_scope messages
    expect(contextMsgs).toHaveLength(4);
    
    // Check they are the correct ones
    expect(contextMsgs.map(m => m.content)).toEqual(['Q1', 'A1', 'Q3', 'A3']);
  });

  it('6c. loadRecentContextMessages correctly handles legacy data (user responseType = null)', async () => {
    const conv = await service.getOrCreateConversation('student-legacy');
    
    // We must manually construct the legacy DB state where USER responseType is null
    const baseDate = Date.now();
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: 'USER', content: 'Legacy weather', responseType: null }
    });
    // Ensure chronological ordering by adding a slight delay or trusting the mock's monotonically increasing timestamp
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'Legacy rejection', responseType: 'out_of_scope' }
    });

    const contextMsgs = await service.loadRecentContextMessages(conv.id, 10);
    // Both should be excluded, even though USER had responseType: null
    expect(contextMsgs).toHaveLength(0);
  });

  it('6d. out_of_scope messages do not consume the context limit', async () => {
    const conv = await service.getOrCreateConversation('student-limit');
    
    // Save 3 valid exchanges (6 messages total)
    await service.saveExchange(conv.id, 'V1', 'A1', 'answer');
    await service.saveExchange(conv.id, 'V2', 'A2', 'answer');
    await service.saveExchange(conv.id, 'V3', 'A3', 'answer');
    
    // Save 4 out_of_scope exchanges (8 messages total)
    await service.saveExchange(conv.id, 'O1', 'O1', 'out_of_scope');
    await service.saveExchange(conv.id, 'O2', 'O2', 'out_of_scope');
    await service.saveExchange(conv.id, 'O3', 'O3', 'out_of_scope');
    await service.saveExchange(conv.id, 'O4', 'O4', 'out_of_scope');

    // If limit is 6, and we didn't filter before limiting, we'd get 0 valid messages.
    const contextMsgs = await service.loadRecentContextMessages(conv.id, 6);
    expect(contextMsgs).toHaveLength(6);
    expect(contextMsgs.map(m => m.content)).toEqual(['V1', 'A1', 'V2', 'A2', 'V3', 'A3']);
  });

  it('6e. no_verified_info exchanges remain context-eligible', async () => {
    const conv = await service.getOrCreateConversation('student-no-info');
    await service.saveExchange(conv.id, 'Q', 'A', 'no_verified_info');
    
    const contextMsgs = await service.loadRecentContextMessages(conv.id, 10);
    expect(contextMsgs).toHaveLength(2);
    expect(contextMsgs[0].responseType).toBe('no_verified_info');
    expect(contextMsgs[1].responseType).toBe('no_verified_info');
  });
});
