import { Injectable, Logger } from '@nestjs/common';
import { ScopeDecision, ScopeDecisionType } from './scope-guard.types.js';
import { ScopeClassifierProvider } from './scope-classifier.provider.js';
import {
  OTHER_UNIVERSITY_NAMES,
  COMPARISON_PATTERNS,
  INSCOPE_REGISTRATION,
  INSCOPE_FEES,
  INSCOPE_DOCUMENTS,
  INSCOPE_ACADEMIC,
  INSCOPE_STUDENT_LIFE,
  INSCOPE_ISSATSO_NAMES,
  OOS_WEATHER,
  OOS_SPORTS,
  OOS_CODING,
  OOS_ENTERTAINMENT,
  OOS_HEALTH,
  OOS_GENERAL_KNOWLEDGE,
  OOS_PROMPT_INJECTION,
} from './scope-guard.constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tokenise a normalised lowercase string into word tokens.
 * Strips punctuation; splits on whitespace.
 */
function tokenise(lower: string): string[] {
  return lower.replace(/[.,!?؟;:'"()\[\]{}<>\/\\]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Test whether any pattern in the array matches the string.
 */
function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

/**
 * Test a token against a Set, with an optional simple prefix check.
 * E.g. "iset" prefix catches "iset sousse", "iset charguia", etc.
 */
function tokenInSet(token: string, set: ReadonlySet<string>): boolean {
  return set.has(token);
}

/**
 * Check if the query contains ISSATSO/ISSAT references.
 */
function hasISSATSOReference(tokens: string[]): boolean {
  return tokens.some(t => INSCOPE_ISSATSO_NAMES.has(t));
}

/**
 * Check if the query references a known other-university name.
 * Returns the matched name or null.
 *
 * Handles:
 *  - Exact token matches (e.g. "insat", "esprit")
 *  - ISET prefix matches (e.g. "iset-sousse", "iset_sfax")
 *  - Does NOT match "issat" (starts with "isat" but is an alias for ISSATSO)
 */
function detectOtherUniversity(tokens: string[]): string | null {
  for (const token of tokens) {
    // Exact match
    if (OTHER_UNIVERSITY_NAMES.has(token)) return token;
    // ISET prefix (e.g. "isetkb", "isetsousse")
    if (token.startsWith('iset') && token !== 'iset' && !token.startsWith('issatso') && !token.startsWith('issat')) {
      return token;
    }
    // INSAT prefix (e.g. "insatcarthage")
    if (token.startsWith('insat') && !token.startsWith('issatso') && !token.startsWith('issat')) {
      return token;
    }
  }
  return null;
}

/**
 * Check if the query contains a comparison pattern.
 */
function hasComparisonIntent(text: string): boolean {
  return COMPARISON_PATTERNS.some(p => p.test(text));
}

/**
 * Check if the query contains at least one strong ISSATSO in-scope signal.
 * Returns the matched category or null.
 */
function detectInScopeSignal(
  tokens: string[],
  originalLower: string,
): { category: string } | null {
  // ISSATSO explicit name
  if (tokens.some(t => INSCOPE_ISSATSO_NAMES.has(t))) {
    return { category: 'issatso_name' };
  }
  // Registration vocabulary
  if (tokens.some(t => INSCOPE_REGISTRATION.has(t))) {
    return { category: 'registration' };
  }
  // Fee vocabulary
  if (tokens.some(t => INSCOPE_FEES.has(t))) {
    return { category: 'fees' };
  }
  // Document vocabulary
  if (tokens.some(t => INSCOPE_DOCUMENTS.has(t))) {
    return { category: 'documents' };
  }
  // Academic levels
  if (tokens.some(t => INSCOPE_ACADEMIC.has(t))) {
    return { category: 'academic' };
  }
  // Student life
  if (tokens.some(t => INSCOPE_STUDENT_LIFE.has(t))) {
    return { category: 'student_life' };
  }
  // "emploi du temps" as a phrase (contains spaces, won't tokenise to single word)
  if (originalLower.includes('emploi du temps')) {
    return { category: 'student_life' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scope Guard Service
// ---------------------------------------------------------------------------

@Injectable()
export class ScopeGuardService {
  private readonly logger = new Logger(ScopeGuardService.name);

  constructor(private readonly classifier: ScopeClassifierProvider) {}

  /**
   * Decide whether `query` is in-scope for ISSATSO.
   *
   * Decision pipeline (first matching rule wins):
   *   1. Prompt injection → out_of_scope (deterministic, high)
   *   2. Other university only → out_of_scope (deterministic, high)
   *   3. Other university + ISSATSO (any mention, with or without comparison) → out_of_scope
   *      Rationale: any query that clearly identifies another institution alongside ISSATSO
   *      is a comparison/redirect query that falls outside our support scope.
   *   4. Strong in-scope signal (no other-university) → in_scope (deterministic, high)
   *   5. Strong out-of-scope domain signal → out_of_scope (deterministic, high)
   *   6. → ambiguous → classifier
   *      6a. Classifier success → result (classifier, medium)
   *      6b. Classifier failure → fallback policy (deterministic, medium)
   *          - any moderate in-scope signal → in_scope
   *          - otherwise → out_of_scope (safe conservative)
   */
  async decide(query: string): Promise<ScopeDecision> {
    const lower = query.toLowerCase();
    const tokens = tokenise(lower);

    this.logger.debug(`[ScopeGuard] decide: "${query.substring(0, 80)}…"`);

    // ── 1. Prompt injection ──────────────────────────────────────────────────
    if (matchesAny(OOS_PROMPT_INJECTION, lower)) {
      return this.out('deterministic', 'high', 'prompt_injection');
    }

    // ── 2 & 3. Other university detection ───────────────────────────────────
    const otherUni = detectOtherUniversity(tokens);
    if (otherUni) {
      const hasISSATSO = hasISSATSOReference(tokens);
      if (!hasISSATSO) {
        // Query is purely about another institution
        return this.out('deterministic', 'high', `other_university:${otherUni}`);
      }
      // ISSATSO also mentioned — check for comparison intent
      if (hasComparisonIntent(lower)) {
        return this.out('deterministic', 'high', `comparison:${otherUni}`);
      }
      // ISSATSO + other university co-mention (even without explicit comparison verb)
      // is always out_of_scope per the strict product rule:
      // any query that clearly identifies another institution is outside our scope.
      this.logger.debug(`[ScopeGuard] ISSATSO+other_uni co-mention (no comparison verb) → out_of_scope.`);
      return this.out('deterministic', 'high', `other_university_comention:${otherUni}`);
    } else {
      // ── 4. Strong in-scope signal ────────────────────────────────────────
      const inScopeSignal = detectInScopeSignal(tokens, lower);
      if (inScopeSignal) {
        this.logger.debug(`[ScopeGuard] strong in-scope signal: ${inScopeSignal.category}`);
        return this.in('deterministic', 'high', `strong_signal:${inScopeSignal.category}`);
      }

      // ── 5. Strong out-of-scope domain ───────────────────────────────────
      if (matchesAny(OOS_WEATHER, lower)) {
        return this.out('deterministic', 'high', 'domain:weather');
      }
      if (matchesAny(OOS_SPORTS, lower)) {
        return this.out('deterministic', 'high', 'domain:sports');
      }
      if (matchesAny(OOS_CODING, lower)) {
        return this.out('deterministic', 'high', 'domain:coding');
      }
      if (matchesAny(OOS_ENTERTAINMENT, lower)) {
        return this.out('deterministic', 'high', 'domain:entertainment');
      }
      if (matchesAny(OOS_HEALTH, lower)) {
        return this.out('deterministic', 'high', 'domain:health');
      }
      if (matchesAny(OOS_GENERAL_KNOWLEDGE, lower)) {
        return this.out('deterministic', 'high', 'domain:general_knowledge');
      }
    }

    // ── 6. Ambiguous → classifier ────────────────────────────────────────────
    this.logger.debug(`[ScopeGuard] ambiguous — calling classifier.`);
    const classifierResult = await this.classifier.classify(query);

    if (classifierResult) {
      return {
        decision: classifierResult.decision,
        confidence: 'medium',
        reason: `classifier:${classifierResult.reasonCode ?? 'ok'}`,
        method: 'classifier',
      };
    }

    // ── 6b. Classifier failed — apply conservative fallback policy ───────────
    this.logger.warn(`[ScopeGuard] Classifier failed — applying fallback policy.`);

    // Fallback: if there is ANY moderate ISSATSO signal, allow the query.
    // This avoids blocking legitimate students when the classifier is unavailable.
    // A weak partial-word check: look for "issat", "issatso" substrings or
    // any inscope-set token that might have been in the ambiguous query
    // (some edge cases pass here because they had ISSATSO+other_uni above).
    const hasModerateInScopeSignal =
      lower.includes('issat') ||
      detectInScopeSignal(tokens, lower) !== null;

    if (hasModerateInScopeSignal) {
      return this.in('deterministic', 'medium', 'classifier_fallback:moderate_inscope_signal');
    }

    return this.out('deterministic', 'medium', 'classifier_fallback:conservative');
  }

  // ---------------------------------------------------------------------------
  // Private factory helpers
  // ---------------------------------------------------------------------------

  private in(
    method: 'deterministic' | 'classifier',
    confidence: 'high' | 'medium',
    reason: string,
  ): ScopeDecision {
    return { decision: 'in_scope', confidence, reason, method };
  }

  private out(
    method: 'deterministic' | 'classifier',
    confidence: 'high' | 'medium',
    reason: string,
  ): ScopeDecision {
    return { decision: 'out_of_scope', confidence, reason, method };
  }
}
