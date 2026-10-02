/**
 * Multilingual Embedding Similarity Test — Ollama + BGE-M3
 *
 * Run: node scripts/test-embedding-similarity.js
 *
 * Requires Ollama to be running locally:
 *   systemctl start ollama        (or: ollama serve)
 *   ollama pull bge-m3
 *
 * Reads OLLAMA_BASE_URL and EMBEDDING_MODEL from .env (or environment).
 * No API key required.
 *
 * Tests multilingual cosine similarity for the ISSATSO registration fees chunk
 * against French, English, Arabic, Darija, Arabizi and mixed queries.
 * Negative (unrelated) queries are included as baselines.
 */

// ── Config ────────────────────────────────────────────────────────────────────

let dotenv;
try {
  dotenv = await import('dotenv');
  dotenv.config();
} catch {
  // If dotenv not available, rely on process.env directly.
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL           = process.env.EMBEDDING_MODEL  || 'bge-m3';
const DIMS            = parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10);

// ── Embed via Ollama ──────────────────────────────────────────────────────────

async function embedBatch(texts) {
  const url  = `${OLLAMA_BASE_URL}/api/embed`;
  const body = JSON.stringify({ model: MODEL, input: texts });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.error(`\n❌  Ollama is not running at ${OLLAMA_BASE_URL}`);
      console.error(`    Start it with: systemctl start ollama`);
      process.exit(1);
    }
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 404 || errText.toLowerCase().includes('not found')) {
      console.error(`\n❌  Model '${MODEL}' is not installed in Ollama.`);
      console.error(`    Install it with: ollama pull ${MODEL}`);
      process.exit(1);
    }
    console.error(`\n❌  Ollama returned HTTP ${res.status}: ${errText}`);
    process.exit(1);
  }

  const json = await res.json();
  const embeddings = json.embeddings;

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    console.error(`\n❌  Count mismatch: sent ${texts.length}, got ${embeddings?.length}`);
    process.exit(1);
  }

  return embeddings;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // ── Source chunk (ISSATSO Licence registration fees) ───────────────────────
  const sourceText =
    "Licence. Montant total des frais d'inscription : 70 DT. " +
    "Premier versement : 40 DT. Deuxième versement : 30 DT.";

  // ── Test queries ────────────────────────────────────────────────────────────
  const tests = [
    // ─── Semantically related ─────────────────────────────────────────────────
    { label: '[FR] French (same meaning)',         text: "Combien coûtent les frais d'inscription en licence ?" },
    { label: '[EN] English (same meaning)',        text: "How much are the licence registration fees?" },
    { label: '[AR] Arabic (same meaning)',         text: "قداش معلوم الترسيم في الإجازة؟" },
    { label: '[DA] Darija Arabic',                 text: "قداش نخلص في ترسيم الليسانس؟" },
    { label: '[AZ] Arabizi',                       text: "Ch9adech inscription licence?" },
    { label: '[AZ] Arabizi variation',             text: "Ch9adech n5alles inscription licence?" },
    { label: '[MX] Arabizi/French mix',            text: "Chnouma frais inscription licence?" },
    { label: '[MX] Darija/French mix',             text: "Ch9adech les frais mta3 inscription licence?" },
    // ─── Unrelated / negative ─────────────────────────────────────────────────
    { label: '[U1] Unrelated — weather',           text: "What's the weather tomorrow?" },
    { label: '[U2] Unrelated — PFE procedure',     text: "What is the PFE procedure?" },
    { label: '[U3] Unrelated — football',          text: "Who won the football match?" },
  ];

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  Ollama Multilingual Similarity Test`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`  Provider : ollama`);
  console.log(`  Model    : ${MODEL}`);
  console.log(`  Dims     : ${DIMS}`);
  console.log(`  URL      : ${OLLAMA_BASE_URL}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`  Source:\n  "${sourceText}"`);
  console.log(`${'═'.repeat(72)}\n`);

  // Embed source + all queries in one batch call
  const allTexts  = [sourceText, ...tests.map(t => t.text)];
  const startMs   = Date.now();
  const allVectors = await embedBatch(allTexts);
  const elapsed   = Date.now() - startMs;

  const sourceVec = allVectors[0];

  console.log(`  Embedded ${allTexts.length} texts in ${elapsed}ms`);
  console.log(`  (avg ${(elapsed / allTexts.length).toFixed(0)}ms/text — CPU-only mode expected)\n`);

  // Validate source dimensions
  if (sourceVec.length !== DIMS) {
    console.error(`\n❌  Dimension mismatch: expected ${DIMS}, got ${sourceVec.length}`);
    process.exit(1);
  }

  console.log(`${'─'.repeat(72)}`);
  console.log('  QUERY                                    SIM     BAR');
  console.log(`${'─'.repeat(72)}`);

  let relatedTotal = 0;
  let relatedCount = 0;
  let unrelatedTotal = 0;
  let unrelatedCount = 0;

  for (let i = 0; i < tests.length; i++) {
    const vec = allVectors[i + 1];
    const sim = cosineSimilarity(sourceVec, vec);
    const barLen = Math.max(0, Math.round(sim * 40));
    const bar = '█'.repeat(barLen);
    const isUnrelated = tests[i].label.startsWith('[U');

    console.log(`  ${tests[i].label.padEnd(40)} ${sim.toFixed(4)}  ${bar}`);

    if (isUnrelated) {
      unrelatedTotal += sim;
      unrelatedCount++;
    } else {
      relatedTotal += sim;
      relatedCount++;
    }
  }

  console.log(`${'─'.repeat(72)}`);
  console.log(`\n  Summary:`);
  console.log(`    Related query avg similarity   : ${(relatedTotal / relatedCount).toFixed(4)}`);
  console.log(`    Unrelated query avg similarity : ${(unrelatedTotal / unrelatedCount).toFixed(4)}`);
  console.log(`    Gap (should be clearly positive): ${((relatedTotal / relatedCount) - (unrelatedTotal / unrelatedCount)).toFixed(4)}`);
  console.log(`\n  ✅  Test complete. Do NOT define a retrieval threshold yet — observe scores only.`);
  console.log(`${'═'.repeat(72)}\n`);
}

run().catch(err => {
  console.error('\n❌  Unexpected error:', err.message);
  process.exit(1);
});
