/**
 * Phase 7 — Scope Guard types.
 * These are internal types and must NOT be leaked to public API responses
 * beyond the safe debug metadata fields defined below.
 */

/** The two possible scope outcomes. */
export type ScopeDecisionType = 'in_scope' | 'out_of_scope';

/** How the decision was reached. */
export type ScopeMethod = 'deterministic' | 'classifier';

/** Confidence level of the decision. */
export type ScopeConfidence = 'high' | 'medium';

/**
 * Full internal scope decision returned by ScopeGuardService.
 * `reason` is for logging/debug only — never expose raw to API callers.
 */
export interface ScopeDecision {
  decision: ScopeDecisionType;
  confidence: ScopeConfidence;
  /** Internal reason code — safe for debug metadata field, not for user-facing text. */
  reason: string;
  method: ScopeMethod;
}

/** Minimal result from the lightweight ambiguous-case classifier. */
export interface ScopeClassificationResult {
  decision: 'in_scope' | 'out_of_scope';
  reasonCode?: string;
}

/** Safe subset exposed in debug metadata. */
export interface ScopeDebugMetadata {
  scopeDecision: ScopeDecisionType;
  scopeMethod: ScopeMethod;
  scopeReasonCode: string;
}
