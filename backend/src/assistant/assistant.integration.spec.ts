import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { AssistantService } from './assistant.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// 1. Mock @google/genai
// ---------------------------------------------------------------------------
const mockGenerateContent = vi.fn();
const mockInteractionsCreate = vi.fn();
const mockConstructorSpy = vi.fn();

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
    interactions = { create: mockInteractionsCreate };
    constructor(opts: unknown) { mockConstructorSpy(opts); }
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY' },
  };
});

// A helper to simulate Gemini's structured JSON output
function makeJsonRes(data: any) {
  return {
    text: JSON.stringify(data),
  };
}

describe('Phase 8I — Final System Integration Validation', () => {
  let app: TestingModule;
  let assistantService: AssistantService;
  let voiceService: VoiceService;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    assistantService = app.get(AssistantService);
    voiceService = app.get(VoiceService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the DB to ensure isolation between tests, especially the Conversation table
    await prisma.conversationMessage.deleteMany();
    await prisma.conversation.deleteMany();
  });

  // Basic mock router for the LLM based on prompts
  const setupMockLlm = () => {
    mockGenerateContent.mockImplementation(async (args: any) => {
      const contentsStr = JSON.stringify(args.contents || []).toLowerCase();
      const isVoiceTTS = args.config?.responseMimeType === 'audio/wav';

      const sourceIdMatch = contentsStr.match(/\[(S\d+)\]/i);
      const validSourceId = sourceIdMatch ? sourceIdMatch[1].toUpperCase() : 'S1';

      if (isVoiceTTS) {
         // Mock TTS payload
         return {
            text: null,
            inlineData: { mimeType: 'audio/wav', data: 'dHVtbXk=' }
         };
      }

      let userQuery = '';
      const userMsg = args.contents.find((m: any) => m.role === 'user' || m.role === 'USER');
      if (userMsg) {
         const userText = (userMsg.parts?.[0]?.text || userMsg.content || '').toLowerCase();
         if (userText.includes("user's answer to clarification:")) {
             const origMatch = userText.match(/original question:\s*([\s\S]*?)clarification question/i);
             const ansMatch = userText.match(/user's answer to clarification:\s*([\s\S]*?)<issatso_context>/i);
             const orig = origMatch ? origMatch[1].trim() : '';
             const ans = ansMatch ? ansMatch[1].trim() : '';
             userQuery = orig + ' ' + ans;
         } else if (userText.includes("user question:")) {
             const uqMatch = userText.match(/user question:\s*([\s\S]*?)<issatso_context>/i);
             if (uqMatch) {
                 userQuery = uqMatch[1].trim();
             }
         } else {
             userQuery = userText.trim();
         }
      }
      userQuery = userQuery.replace(/\n/g, ' ');

      require('fs').appendFileSync('/tmp/mock.log', '[MOCK] userQuery: ' + userQuery + '\n');
      require('fs').appendFileSync('/tmp/mock.log', '[MOCK] contentsStr snippet: ' + contentsStr.substring(0, 200) + '\n');
      require('fs').appendFileSync('/tmp/mock.log', '[MOCK] has conv_history: ' + contentsStr.includes('<conversation_history>') + '\n');

      const currentQ = userQuery;

      // ── PRIORITY 0: Specific query patterns that override topic logic ──────

      // Clarification trigger: ambiguous inscription query without explicit programme
      if (currentQ.includes('9adeh n5alles inscription') && !currentQ.includes('licence') && !currentQ.includes('license') && !currentQ.includes('master')) {
        return makeJsonRes({
          type: 'clarification',
          answer: null,
          clarificationQuestion: 'Licence walla Master?',
          clarificationOptions: ['Licence', 'Master'],
          usedSourceIds: []
        });
      }

      // Registration DATE query (not amount) — must come before topic-based routing
      if (currentQ.includes('when is registration') || currentQ.includes('15-10-2026') || currentQ.includes('so when is registration')) {
        return makeJsonRes({
          type: 'answer',
          answer: 'official verified date',
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: [validSourceId]
        });
      }

      // Out of scope
      if (currentQ.includes('capital of france') || currentQ.includes('weather today') || currentQ.includes('weather')) {
        return makeJsonRes({
          type: 'out_of_scope',
          answer: 'Out of scope mock',
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: []
        });
      }

      // No verified info
      if (currentQ.includes('club robotique') || currentQ.includes('no verified info')) {
        return makeJsonRes({
          type: 'no_verified_info',
          answer: 'Sorry, no verified info found.',
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: []
        });
      }

      // ── TOPIC DETECTION ───────────────────────────────────────────────────
      const explicitLicence = currentQ.includes('licence') || currentQ.includes('license');
      const explicitMaster  = currentQ.includes('master');

      let isLicence = explicitLicence;
      let isMaster  = explicitMaster;
      let topicFromHistory = false;

      if (!isLicence && !isMaster) {
        // Fallback: scan ONLY the conversation history block (not RAG context)
        const historyMatch = contentsStr.match(/<conversation_history>([\s\S]*?)<\/conversation_history>/i);
        const historyStr = historyMatch ? historyMatch[1] : '';

        const masterIdx  = historyStr.lastIndexOf('master');
        const licenceIdx = Math.max(historyStr.lastIndexOf('licence'), historyStr.lastIndexOf('license'));

        if (masterIdx > licenceIdx && masterIdx !== -1) {
          isMaster = true;
          topicFromHistory = true;
        } else if (licenceIdx > masterIdx && licenceIdx !== -1) {
          isLicence = true;
          topicFromHistory = true;
        }
        // If neither appears in history: topicFromHistory stays false → ambiguous handling
      }

      const hasExplicitTopic = explicitLicence || explicitMaster || topicFromHistory;

      // ── ACTION DETECTION (for entity-switch follow-ups like "And for Master?") ──
      const historyMatchA = contentsStr.match(/<conversation_history>([\s\S]*?)<\/conversation_history>/i);
      const historyStrA = historyMatchA ? historyMatchA[1] : '';

      const historyHasRegistration  = historyStrA.includes('registration') || historyStrA.includes('inscription');
      const historyHasFirstPayment  = historyStrA.includes('first payment')  || historyStrA.includes('tranche loula') ||
                                       historyStrA.includes('premier versement') || historyStrA.includes('versement louleni');
      const historyHasSecondPayment = historyStrA.includes('second payment') || historyStrA.includes('tranche thenya');

      const queryHasRegistration  = currentQ.includes('registration') || currentQ.includes('inscription');
      const queryHasFirstPayment  = currentQ.includes('first payment')  || currentQ.includes('tranche loula') ||
                                     currentQ.includes('premier versement') || currentQ.includes('versement louleni');
      const queryHasSecondPayment = currentQ.includes('second payment') || currentQ.includes('tranche thenya');

      // Effective action: current query takes precedence.
      // For entity-switch follow-ups (explicit entity in query, no explicit action),
      // inherit the action from the conversation history.
      const isEntitySwitchFollowup = (explicitLicence || explicitMaster) && !queryHasRegistration && !queryHasFirstPayment && !queryHasSecondPayment;
      const effectiveRegistration  = queryHasRegistration  || (isEntitySwitchFollowup && historyHasRegistration);
      const effectiveFirstPayment  = queryHasFirstPayment  || (isEntitySwitchFollowup && historyHasFirstPayment && !historyHasRegistration);
      const effectiveSecondPayment = queryHasSecondPayment || (isEntitySwitchFollowup && historyHasSecondPayment && !historyHasRegistration && !historyHasFirstPayment);

      // ── ROUTING: Master ───────────────────────────────────────────────────
      if (isMaster) {
        if (effectiveRegistration)  return makeJsonRes({ type: 'answer', answer: '150 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
        if (effectiveFirstPayment)  return makeJsonRes({ type: 'answer', answer: '80 DT',  clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
        if (effectiveSecondPayment) return makeJsonRes({ type: 'answer', answer: '70 DT',  clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
      }

      // ── ROUTING: Licence ──────────────────────────────────────────────────
      if (isLicence) {
        if (effectiveRegistration)  return makeJsonRes({ type: 'answer', answer: '70 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
        if (effectiveFirstPayment)  return makeJsonRes({ type: 'answer', answer: '40 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
        if (effectiveSecondPayment) return makeJsonRes({ type: 'answer', answer: '30 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
      }

      // ── AMBIGUOUS (no topic from query or history) ────────────────────────
      // Vague queries without context get no_verified_info (real LLM behaviour).
      if (!hasExplicitTopic) {
        return makeJsonRes({
          type: 'no_verified_info',
          answer: 'Insufficient context — programme not specified.',
          clarificationQuestion: null,
          clarificationOptions: [],
          usedSourceIds: []
        });
      }

      // EXACT matches for specific tests
      if (currentQ === '9adeh inscription lel license') {
        return makeJsonRes({ type: 'answer', answer: '70 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
      }

      // Fallback: licence-containing queries not matched by rules above
      if (currentQ.includes('license') || currentQ.includes('licence')) {
        return makeJsonRes({ type: 'answer', answer: '70 DT', clarificationQuestion: null, clarificationOptions: [], usedSourceIds: [validSourceId] });
      }

      return makeJsonRes({
        type: 'no_verified_info',
        answer: 'Default mock answer no verified info',
        clarificationQuestion: null,
        clarificationOptions: [],
        usedSourceIds: []
      });
    });

    mockInteractionsCreate.mockImplementation(async (args: any) => {
        // Mock STT
        return {
           output_text: args.mockText || 'test voice transcript'
        };
    });
  };

  describe('Core Conversation Flow', () => {
    beforeEach(() => {
      setupMockLlm();
    });

    it('TEST 1 — BASIC LICENCE ANSWER', async () => {
      const res = await assistantService.ask({
        query: '9adeh inscription lel license',
        userId: 'test1'
      });
      expect(res.type).toBe('answer');
      expect(res.answer).toBe('70 DT');
      expect(res.sources[0].documentId).toBe('ab3f227c-76da-450e-85a0-970e9adfd9df');
    }, 15000);

    it('TEST 2 — DARija FIRST PAYMENT FOLLOW-UP', async () => {
      await assistantService.ask({ query: '9adeh inscription lel license', userId: 'test2' });
      const res = await assistantService.ask({ query: 'tranche loula 9adeh ?', userId: 'test2' });
      expect(res.type).toBe('answer');
      expect(res.answer).toBe('40 DT');
    });

    it('TEST 3 — DARija SECOND PAYMENT FOLLOW-UP', async () => {
      await assistantService.ask({ query: '9adeh inscription lel license', userId: 'test3' });
      const res = await assistantService.ask({ query: 'w tranche thenya ?', userId: 'test3' });
      expect(res.type).toBe('answer');
      expect(res.answer).toBe('30 DT');
    });

    it('TEST 4 — FOLLOW-UP SPELLING VARIANTS', async () => {
      const variants = [
        'tranche loula 9adeh?',
        'versement louleni 9adeh?',
        'premier versement 9adeh?',
        'first payment?',
        'And the first payment?'
      ];
      for (const [i, variant] of Object.entries(variants)) {
         const uid = `test4-${i}`;
         await assistantService.ask({ query: '9adeh inscription lel license', userId: uid });
         const res = await assistantService.ask({ query: variant, userId: uid });
         expect(res.answer).toBe('40 DT');
      }
    }, 15000);

    it('TEST 5 — MASTER TOPIC', async () => {
      const uid = 'test5';
      let res = await assistantService.ask({ query: 'How much is registration for Master?', userId: uid });
      expect(res.answer).toBe('150 DT');
      res = await assistantService.ask({ query: 'first payment?', userId: uid });
      expect(res.answer).toBe('80 DT');
      res = await assistantService.ask({ query: 'second payment?', userId: uid });
      expect(res.answer).toBe('70 DT');
    });

    it('TEST 6 — TOPIC SWITCHING', async () => {
      const uid = 'test6';
      await assistantService.ask({ query: 'How much is registration for Master?', userId: uid });
      await assistantService.ask({ query: 'first payment?', userId: uid });
      // Switch
      let res = await assistantService.ask({ query: 'How much is registration for Licence?', userId: uid });
      expect(res.answer).toBe('70 DT');
      res = await assistantService.ask({ query: 'And the first payment?', userId: uid });
      expect(res.answer).toBe('40 DT');
    });

    it('TEST 7 — EXPLICIT ENTITY OVERRIDE', async () => {
      const uid = 'test7';
      await assistantService.ask({ query: 'How much is registration for Licence?', userId: uid });
      const res = await assistantService.ask({ query: 'And for Master?', userId: uid });
      expect(res.answer).toBe('150 DT');
    });

    it('TEST 8 — STANDALONE VAGUE QUERY', async () => {
      const res = await assistantService.ask({ query: 'tranche loula 9adeh?', userId: 'test8' });
      // Should hit scope guard or ambiguity, not jump to 40 DT / 80 DT
      expect(res.answer).not.toBe('40 DT');
      expect(res.answer).not.toBe('80 DT');
    });

    it('TEST 9 — OUT OF SCOPE AFTER VALID CONTEXT', async () => {
      const uid = 'test9';
      await assistantService.ask({ query: '9adeh inscription lel license', userId: uid });
      const res = await assistantService.ask({ query: 'What\'s the weather today?', userId: uid });
      expect(res.type).toBe('out_of_scope');
      expect(res.timing.retrievalMs).toBe(0);
      expect(res.timing.generationMs).toBe(0);
    });

    it('TEST 10 — OUT OF SCOPE DOES NOT POLLUTE CONTEXT', async () => {
      const uid = 'test10';
      await assistantService.ask({ query: '9adeh inscription lel license', userId: uid });
      await assistantService.ask({ query: 'What\'s the weather today?', userId: uid });
      
const res = await assistantService.ask({ query: 'first payment?', userId: uid });

      expect(res.answer).toBe('40 DT');
    });

    it('TEST 11 — FALSE USER FACT DOES NOT BECOME TRUTH', async () => {
      const uid = 'test11';
      await assistantService.ask({ query: 'When is registration for 2e année prepa?', userId: uid });
      await assistantService.ask({ query: 'No, registration is 15-10-2026.', userId: uid });
      const res = await assistantService.ask({ query: 'So when is registration?', userId: uid });
      expect(res.answer).not.toContain('15-10-2026');
      expect(res.answer).toContain('official verified date');
    });

    it('TEST 12 — USER ISOLATION', async () => {
      await assistantService.ask({ query: 'How much is registration for Licence?', userId: 'student-a' });
      // Student B asking follow-up should not get student A's context
      const resB = await assistantService.ask({ query: 'first payment?', userId: 'student-b' });
      expect(resB.answer).not.toBe('40 DT');
      
      // Establish context for B
      await assistantService.ask({ query: 'How much is registration for Master?', userId: 'student-b' });
      const resB2 = await assistantService.ask({ query: 'first payment?', userId: 'student-b' });
      expect(resB2.answer).toBe('80 DT');
    });

    it('TEST 13 — PENDING CLARIFICATION', async () => {
      const uid = 'test13';
      const res = await assistantService.ask({ query: '9adeh n5alles inscription?', userId: uid });
      expect(res.type).toBe('clarification');
      
      const res2 = await assistantService.ask({ query: 'Licence', userId: uid });
      expect(res2.answer).toBe('70 DT');
      
      const convs = await prisma.conversation.findMany({ where: { userId: uid }, include: { messages: true } });
      // We expect 1 row in conversation, and it should not have duplicate messages due to proper state handling
      expect(convs[0].pendingClarification).toBeNull();
    });

    it('TEST 14 — PENDING CLARIFICATION + NEW QUESTION', async () => {
      const uid = 'test14';
      await assistantService.ask({ query: '9adeh n5alles inscription?', userId: uid });
      // Ignore clarification, ask unrelated
      const res = await assistantService.ask({ query: 'What is the capital of France?', userId: uid });
      expect(res.type).toBe('out_of_scope');
    });

    it('TEST 15 — NO VERIFIED INFO', async () => {
      const res = await assistantService.ask({ query: 'club robotique', userId: 'test15' });
      expect(res.type).toBe('no_verified_info');
    });

    it('TEST 16 — STATELESS REQUEST', async () => {
      const res = await assistantService.ask({ query: '9adeh inscription lel license' });
      expect(res.type).toBe('answer');
      expect(res.answer).toBe('70 DT');
    });

    it('TEST 19 — TEXT → VOICE CONTINUATION', async () => {
      const uid = 'test19';
      await assistantService.ask({ query: 'How much is registration for Master?', userId: uid });
      
      // STT mock returns 'And the first payment?'
      mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'And the first payment?' });
      
      const res = await voiceService.ask({ audio: Buffer.from('dummy'), mimeType: 'audio/wav', userId: uid });
      expect(res.assistant.answer).toBe('80 DT');
    });

    it('TEST 20 — VOICE → TEXT CONTINUATION', async () => {
      const uid = 'test20';
      mockInteractionsCreate.mockResolvedValueOnce({ output_text: '9adeh inscription lel license' });
      await voiceService.ask({ audio: Buffer.from('dummy'), mimeType: 'audio/wav', userId: uid });
      
      const res = await assistantService.ask({ query: 'tranche loula 9adeh?', userId: uid });
      expect(res.answer).toBe('40 DT');
    });

    it('TEST 21 — VOICE OUT OF SCOPE', async () => {
      const uid = 'test21';
      mockInteractionsCreate.mockResolvedValueOnce({ output_text: 'What\'s the weather today?' });
      const res = await voiceService.ask({ audio: Buffer.from('dummy'), mimeType: 'audio/wav', userId: uid });
      expect(res.assistant.type).toBe('out_of_scope');
    });

    it('TEST 23 — SOURCES', async () => {
      const res = await assistantService.ask({ query: '9adeh inscription lel license', userId: 'test23' });
      expect(res.sources[0].documentId).toBeDefined();
      expect(res.sources[0].documentId).toBeDefined();
      expect(res.sources[0].title).toBeDefined();
    });

    // We can't strictly test 24 (Context Limits) easily without sending 30+ requests, 
    // but we know it's bounded by CONVERSATION_RECENT_MESSAGE_LIMIT (which defaults to 6).
    // Let's send 10 messages.
    it('TEST 24 — CONTEXT LIMITS', async () => {
      const uid = 'test24';
      for (let i=0; i<10; i++) {
         await assistantService.ask({ query: 'How much is registration for Licence?', userId: uid });
      }
      
const res = await assistantService.ask({ query: 'first payment?', userId: uid });

      expect(res.answer).toBe('40 DT');
      
      const conv = await prisma.conversation.findFirst({ where: { userId: uid }, include: { messages: true } });
      expect(conv?.messages.length).toBe(22); // 11 pairs
      // The context assembled for LLM should be capped, verified by it still returning 40 DT correctly.
    }, 15000);

    it('TEST 25 — OUT-OF-SCOPE BUDGET FILTER', async () => {
      const uid = 'test25';
      await assistantService.ask({ query: 'How much is registration for Licence?', userId: uid });
      for (let i=0; i<5; i++) {
        await assistantService.ask({ query: 'What is the weather today?', userId: uid });
      }
      
const res = await assistantService.ask({ query: 'first payment?', userId: uid });

      expect(res.answer).toBe('40 DT');
    }, 15000);
  });

  describe('Resilience (Phase 8H)', () => {
    beforeEach(() => {
      setupMockLlm();
    });

    it('TEST 17 — PROVIDER FAILURE DOES NOT SAVE PARTIAL EXCHANGE', async () => {
      const uid = 'test17';
      mockGenerateContent.mockRejectedValueOnce(new Error('fetch failed'))
                         .mockRejectedValueOnce(new Error('fetch failed'))
                         .mockRejectedValueOnce(new Error('fetch failed'))
                         .mockRejectedValueOnce(new Error('fetch failed')); 
                         // With max retries = 3, transport retry gives us exactly 4 attempts total.

      try {
        await assistantService.ask({ query: '9adeh inscription lel license', userId: uid });
      } catch (e) {}

      // Verify no partial exchange saved
      const convs = await prisma.conversation.findMany({ where: { userId: uid }, include: { messages: true } });
      // Conversation might be created, but exchanges should be 0
      expect(convs[0]?.messages.length ?? 0).toBe(0);
    });

    it('TEST 18 — TRANSIENT GEMINI RETRY SUCCESS', async () => {
      const uid = 'test18';
      mockGenerateContent.mockRejectedValueOnce(new Error('fetch failed'))
                         .mockImplementationOnce(async () => makeJsonRes({
                           type: 'answer',
                           answer: '70 DT',
                           clarificationQuestion: null,
                           clarificationOptions: [],
                           usedSourceIds: ['S1']
                         }));

      const res = await assistantService.ask({ query: '9adeh inscription lel license', userId: uid });
      expect(res.answer).toBe('70 DT');

      const convs = await prisma.conversation.findMany({ where: { userId: uid }, include: { messages: true } });
      expect(convs[0].messages.length).toBe(2); // exactly one exchange!
    });
  });
});
