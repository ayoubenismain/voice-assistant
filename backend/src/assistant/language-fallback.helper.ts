/**
 * Lightweight deterministic language detection for fallback messages.
 *
 * Uses simple script/lexicon heuristics — no external NLP library.
 * The patterns are intentionally kept consistent with the logic already
 * present in DarijaNormalizerService (darija-normalizer.service.ts) so
 * the two systems agree on what counts as Arabic-script, Arabizi, etc.
 *
 * Detection priority (first match wins):
 *   1. Arabic script  → Arabic
 *   2. Arabizi digits → Tunisian Darija / Arabizi
 *   3. Darija tokens  → Tunisian Darija
 *   4. English stops  → English
 *   5. French stops   → French
 *   6. Default        → neutral bilingual (EN + FR)
 */

/** Detected language category used only for fallback message selection. */
export type FallbackLanguage = 'arabic' | 'arabizi' | 'french' | 'english' | 'neutral';

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** Arabic script Unicode range — same regex used in DarijaNormalizerService. */
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

/**
 * Arabizi heuristic: digits used as phonetic substitutes (9, 3, 7, kh, gh…)
 * stripped of legitimate ordinals like 1er, 2ème, 3rd, 4th etc.
 * This mirrors the logic in DarijaNormalizerService line 133.
 */
const ARABIZI_DIGIT_RE = /[3679]/;
const ORDINAL_STRIP_RE = /\d+\s*(dt|er|ème|eme|ère|ere|e|st|nd|rd|th)\b/gi;

/**
 * Common Darija / Arabizi tokens that are not digits but unmistakably Tunisian.
 * A single match is sufficient.
 */
const DARIJA_TOKENS = new Set([
  'chkoun', 'chnou', 'chneya', 'win', 'ki', 'kifeh', 'waqteh', 'bech', 'elli',
  'mta3', 'mte3', 'fih', 'fيه', 'nabs', 'nafs', 'hedha', 'heka',
  'wa9tech', 'wa9t', 'ech', 'nkhedm', 'n5alles', 'n5ales', 'nkhal',
  'loula', 'thaniya', 'thaltha', 'rab3a', 'khamsa',
  'yijem', 'yimken', 'lazem', 'mche', 'roh', 'aji', 'ahia',
  'lezemha', 'lezem', 'barka', 'barsha', 'chwaya',
  // Common Darija situational words (weather, time, greetings)
  'jaw', 'lyom', 'ghoudwa', 'nhar', 'lebes', 'mazel', 'famma',
]);

/**
 * French stop-word set — same list used in DarijaNormalizerService.
 * ≥2 matches → likely French.
 */
const FRENCH_STOPS = [
  'est-ce', 'que', 'le', 'la', 'les', 'un', 'une', 'des',
  'pour', 'dans', 'sur', 'avec', 'et', 'qui', 'quel', 'quelle',
  'quels', 'quelles', 'comment', 'quand', 'où', 'est', 'sont',
];

/**
 * English stop-word set — same padded-match approach used in DarijaNormalizerService.
 */
const ENGLISH_STOPS = [
  ' is ', ' can ', ' the ', ' do ', ' does ', ' how ', ' what ',
  ' when ', ' are ', ' to ', ' in ', ' at ', ' i ', ' my ', ' me ',
  ' who ', ' where ', ' which ', ' was ', ' were ', ' has ', ' have ',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the most likely language of `query`.
 * Returns a FallbackLanguage value — never throws.
 */
export function detectFallbackLanguage(query: string): FallbackLanguage {
  if (!query || !query.trim()) return 'neutral';

  const lower = query.toLowerCase();
  const paddedLower = ` ${lower.replace(/[.,!?؟]/g, ' ')} `;

  // 1. Arabic script — highest confidence, detected by Unicode range
  if (ARABIC_SCRIPT_RE.test(query)) {
    return 'arabic';
  }

  // 2. Arabizi — digits used as phonemes (9adech, 3andek, 7aja…)
  const strippedOrdinals = lower.replace(ORDINAL_STRIP_RE, '');
  if (ARABIZI_DIGIT_RE.test(strippedOrdinals)) {
    return 'arabizi';
  }

  // 3. Darija tokens — word-boundary check
  const tokens = lower.replace(/[.,!?؟']/g, ' ').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (DARIJA_TOKENS.has(token)) {
      return 'arabizi'; // Darija Latin → same response bucket as Arabizi
    }
  }

  // 4. English stop words (padded to avoid false substring matches)
  const englishMatches = ENGLISH_STOPS.filter(w => paddedLower.includes(w)).length;
  if (englishMatches >= 1) {
    return 'english';
  }

  // 5. French stop words
  const frenchMatches = FRENCH_STOPS.filter(w => lower.includes(w)).length;
  if (frenchMatches >= 2) {
    return 'french';
  }

  return 'neutral';
}

// ---------------------------------------------------------------------------
// Fallback message catalogue
// ---------------------------------------------------------------------------

/**
 * Return a safe, grounded `no_verified_info` fallback message in the
 * language that best matches the original user query.
 *
 * This is ONLY used by AssistantService for deterministic service-level
 * fallbacks (e.g. fast-fail when retrieval returns nothing, or when
 * source validation rejects a model-generated answer).
 *
 * It does NOT replace Gemini's own model-generated response when type=no_verified_info
 * is returned with a non-null answer field.
 */
export function buildNoVerifiedInfoFallback(query: string): string {
  const lang = detectFallbackLanguage(query);

  switch (lang) {
    case 'arabic':
      return 'لم أجد معلومات موثوقة حول هذا الموضوع في مصادر ISSATSO المتوفرة.';

    case 'arabizi':
      return "Ma l9itech ma3louma vérifiée 3la hedha fil sources ISSATSO elli 3anna.";

    case 'english':
      return "I couldn't find verified information about that in the available ISSATSO sources.";

    case 'french':
      return "Je n'ai pas trouvé d'information vérifiée à ce sujet dans les sources ISSATSO disponibles.";

    case 'neutral':
    default:
      // Safe bilingual neutral — avoids imposing French on non-French users
      return "I couldn't find verified information about that in the available ISSATSO sources. / Je n'ai pas trouvé d'information vérifiée à ce sujet dans les sources ISSATSO disponibles.";
  }
}

// ---------------------------------------------------------------------------
// Out-of-scope message catalogue
// ---------------------------------------------------------------------------

/**
 * Return a polite, language-aware rejection message for out-of-scope queries.
 *
 * Used by AssistantService when ScopeGuardService returns out_of_scope.
 * Does NOT call Gemini — purely deterministic.
 *
 * Safety rule: this message MUST NOT contain any answer to the user's question.
 * It only explains that the assistant is ISSATSO-only.
 */
export function buildOutOfScopeMessage(query: string): string {
  const lang = detectFallbackLanguage(query);

  switch (lang) {
    case 'arabic':
      return 'يمكنني المساعدة فقط في الأسئلة المتعلقة بـ ISSATSO.';

    case 'arabizi':
      return "Najjem n3awnek ken fi les questions elli 3andhom 3ala9a b ISSATSO.";

    case 'english':
      return "I can only help with ISSATSO-related questions.";

    case 'french':
      return "Je peux uniquement répondre aux questions liées à l'ISSATSO.";

    case 'neutral':
    default:
      return "I can only help with ISSATSO-related questions. / Je peux uniquement répondre aux questions liées à l'ISSATSO.";
  }
}
