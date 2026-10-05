/**
 * Phase 7 — Scope Guard constants.
 *
 * Design principles:
 * - Keep patterns DISCRIMINATIVE, not broad.
 * - Prefer multi-token patterns to avoid single-word false positives.
 * - ISSATSO-domain vocabulary takes precedence; do not accidentally reject
 *   legitimate student questions.
 * - Patterns are case-insensitive (callers normalise to lowercase first).
 */

// ---------------------------------------------------------------------------
// OTHER TUNISIAN UNIVERSITIES / INSTITUTES
// Matched as whole words (word-boundary logic applied by the detector).
// This list is extensible — add more names as needed.
// ISSATSO / ISSAT are intentionally NOT in this list.
// ---------------------------------------------------------------------------

export const OTHER_UNIVERSITY_NAMES: ReadonlySet<string> = new Set([
  // National engineering schools
  'insat',
  'enis',
  'enit',
  'ensi',
  'esim',
  'enicarthage',
  // Private engineering schools
  'esprit',
  'medtech',
  'polytechno',
  // ISET family (any campus — matched by prefix logic in service)
  'iset',
  // Faculties
  'fst',
  'fsb',
  'fss',
  'fsm',
  'fseg',
  'fac',           // "la fac" alone is too broad; used only alongside pattern
  // Higher institutes
  'isi',
  'isims',
  'isamm',
  'isitcom',
  'issig',
  'isam',
  'isbam',
  'ism',
  'islatn',
  'isccbsousse',
  // Other notable institutions
  'supcom',
  'ihec',
  'ihe',
  'ipein',
  'isbs',
  'istmt',
  'istls',
  'issep',
]);

/**
 * Comparison-intent patterns that, when combined with another university,
 * indicate the user is comparing institutions → out_of_scope.
 */
export const COMPARISON_PATTERNS: readonly RegExp[] = [
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bcompare\b/i,
  /\bcompar/i,           // compare, comparaison, comparer…
  /\bor\b.*\buniversity\b/i,
  /\bfar9\s*(bin|b)/i,   // Darija: "far9 bin" = difference between
  /\bfar9\b/i,
  /\bou\s+bien\b/i,      // French: "ou bien" as comparator
  /\bbetter\s+than\b/i,
  /\bmeilleur\s+que\b/i,
  /\b(which|quel|ايهم|أيهم)\s+(is\s+)?(better|best|أحسن|أفضل)\b/i,
  /\b(أحسن|أفضل)\s+من\b/i,
  /\bchnouma\s+far9\b/i, // Darija: "what's the difference"
  // Arabic / MSA comparison patterns
  /الفرق\s+بين/,         // "the difference between" (MSA + Darija)
  /شنوة\s+الفرق/,        // "what's the difference" (Tunisian Darija)
  /ما\s+الفرق/,          // "what is the difference" (MSA)
  /\bقارن\b/,            // "compare" (imperative, MSA + Darija)
  /\bمقارنة\b/,          // "comparison" (noun, MSA)
];

// ---------------------------------------------------------------------------
// STRONG IN-SCOPE SIGNALS
// Vocabulary strongly associated with ISSATSO student life.
// One match → high-confidence in_scope (no classifier needed).
// ---------------------------------------------------------------------------

/**
 * Registration-domain tokens (Darija, French, English, Arabic).
 * Word-boundary matched in the service.
 */
export const INSCOPE_REGISTRATION: ReadonlySet<string> = new Set([
  // Darija / Arabizi
  'inscription', 'tasjil', 'inscri',
  'nsajel', 'tsajel', 'inscrire',
  // Arabic
  'تسجيل', 'التسجيل', 'مسجل',
  // English
  'enrollment', 'enrolment', 'register', 'registration',
  // Common abbreviation
  'inscript',
]);

/**
 * Fee-domain tokens.
 */
export const INSCOPE_FEES: ReadonlySet<string> = new Set([
  // Darija / Arabizi
  'n5alles', '5alles', 'nkhalles', 'khalles', 'nkhales',
  'frais', 'paiement',
  // Arabic
  'معلوم', 'معاليم', 'خلاص', 'دفع', 'رسوم',
  // English
  'fees', 'tuition', 'pay', 'payment',
  // Amounts context (used only when combined with other signals)
]);

/**
 * Document-domain tokens.
 */
export const INSCOPE_DOCUMENTS: ReadonlySet<string> = new Set([
  // Darija / Arabizi
  'wra9', 'wraq', 'wara9',
  'dossier', 'papiers',
  // Arabic
  'وثائق', 'وثيقة', 'ملف', 'أوراق',
  // English / French
  'documents', 'document', 'paperwork', 'file',
]);

/**
 * Academic-level tokens.
 */
export const INSCOPE_ACADEMIC: ReadonlySet<string> = new Set([
  'licence', 'lisans', 'licentiate',
  'master', 'mastère', 'mastere',
  'prépa', 'prepa', 'préparatoire', 'preparatoire',
  'ingénieur', 'ingenieur',
  'doctorat', 'phd',
  'cycle',
  'baccalauréat', 'bac',
  // Arabic
  'ليسانس', 'ماستر', 'دكتوراه',
]);

/**
 * ISSATSO-specific student life tokens.
 */
export const INSCOPE_STUDENT_LIFE: ReadonlySet<string> = new Set([
  'pfe',               // Projet de Fin d'Études
  'stage',             // internship
  'rattrapage',        // catch-up exam
  'examen', 'exam',
  'emploi du temps',   // schedule (treated as phrase)
  'emploi',
  'bibliothèque', 'bibliotheque', 'library',
  'club',
  'scolarité', 'scolarite',
  'département', 'departement', 'department',
  'filière', 'filiere',
  'niveau',
  'année', 'annee',
  // Arabic
  'مناظرة', 'امتحان', 'نادي',
  // Arabizi
  'wa9tech', 'wa9t',   // "when"  — almost always ISSATSO timing query
]);

/** Explicit ISSATSO name tokens. */
export const INSCOPE_ISSATSO_NAMES: ReadonlySet<string> = new Set([
  'issatso', 'issat sousse', 'issat',
]);

// ---------------------------------------------------------------------------
// STRONG OUT-OF-SCOPE PATTERNS
// High-confidence discriminative RegExps only.
// Keep narrow — prefer false negatives (miss) over false positives (reject
// a legitimate ISSATSO query).
// ---------------------------------------------------------------------------

/**
 * Weather queries.
 * "jaw" alone is too short — require additional context.
 */
export const OOS_WEATHER: readonly RegExp[] = [
  /\bweather\b/i,
  /\bm[eé]t[eé]o\b/i,
  /\bforecast\b/i,
  /\bchneya\s+el\s*jaw\b/i,   // what is the weather
  /\bel\s+jaw\s+(lyom|ghoudwa|nhar)\b/i,
  /\bjaw\s+lyom\b/i,
  /\btemperature\s+(today|tomorrow)\b/i,
  /\bva-t-il\s+pleuvoir\b/i,
  /\bpluie\s+aujourd'hui\b/i,
];

/**
 * Sports results / scores — not ISSATSO exams.
 */
export const OOS_SPORTS: readonly RegExp[] = [
  /\bscore\s+(of|du|de\s+la)\b/i,
  /\bwho\s+won\s+the\s+match\b/i,
  /\bresultat\s+du\s+match\b/i,
  /\b(barcelona|real\s*madrid|psg|juventus|manchester|liverpool|chelsea)\b/i,
  /\b(ligue\s*1|premier\s+league|la\s+liga|champions\s+league|europa\s+league)\b(?!\s+(issatso|issat))/i,
  /\bfootball\s+match\b/i,
];

/**
 * Software development / coding — distinct from ISSATSO computer science programs.
 */
export const OOS_CODING: readonly RegExp[] = [
  /\bbuild\s+a\s+(react|vue|angular|node|express|django|flask|spring|laravel)\b/i,
  /\b(fix|debug)\s+(this\s+)?(code|error|bug|exception)\b/i,
  /\bnpm\s+install\b/i,
  /\bpip\s+install\b/i,
  /\bgit\s+(commit|push|pull|clone|merge)\b/i,
  /\bhow\s+(do\s+i|to)\s+(code|program|build|create)\s+(a|an)\s+(react|vue|python|node|web\s+app)\b/i,
  /\bjavascript\s+(tutorial|guide|snippet)\b/i,
  /\bpython\s+(script|code|snippet|tutorial)\b/i,
  /\bsql\s+(query|tutorial)\b/i,
];

/**
 * Entertainment / media — movies, series, music.
 */
export const OOS_ENTERTAINMENT: readonly RegExp[] = [
  /\brecommend\s+(me\s+)?(a\s+)?(movie|film|series|show|book)\b/i,
  /\bsugg[eè]re-moi\b/i,
  /\bwhat\s+to\s+watch\b/i,
  /\bnetflix\s+(series|show|movie)\b/i,
  /\bbest\s+movie\b/i,
  /\bfilm\s+mazel\b/i,         // Darija "recommend a movie"
];

/**
 * Health / medical advice.
 */
export const OOS_HEALTH: readonly RegExp[] = [
  /\bsymptoms?\s+of\b/i,
  /\bwhat\s+medicine\s+(should|can)\b/i,
  /\bmedical\s+advice\b/i,
  /\bdosage\s+of\b/i,
  /\bside\s+effect\s+of\b/i,
];

/**
 * General world-knowledge queries that cannot be about ISSATSO.
 */
export const OOS_GENERAL_KNOWLEDGE: readonly RegExp[] = [
  /\bcapital\s+of\s+(france|spain|germany|usa|america|italy|uk|britain|russia|china|japan|india|brazil|canada|australia|egypt|morocco|algeria)\b/i,
  /\bwho\s+is\s+(elon|mark\s+zuckerberg|bill\s+gates|jeff\s+bezos|donald\s+trump|emmanuel\s+macron|messi|ronaldo)\b/i,
  /\bwhat\s+is\s+the\s+speed\s+of\s+light\b/i,
  /\bwhat\s+is\s+the\s+(meaning|definition)\s+of\b.*(?!issatso)/i,
];

/**
 * Prompt-injection / jailbreak patterns — trying to override the assistant
 * persona. These also indicate out-of-scope intent.
 */
export const OOS_PROMPT_INJECTION: readonly RegExp[] = [
  /\bignore\s+(all\s+)?(previous\s+)?instructions?\b/i,
  /\bignore\s+(the\s+)?issatso\s+(restriction|context|rule|limit)\b/i,
  /\byou\s+are\s+now\s+(a|an)\s+general\b/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  /\bact\s+as\s+(?!an\s+issatso)\b/i,  // "act as an ISSATSO assistant" is fine
  /\bdisregard\s+(your|the)\s+(issatso|system|previous)\b/i,
  /\bforget\s+(your\s+)?(issatso\s+)?(instructions?|rules?|constraints?)\b/i,
];
