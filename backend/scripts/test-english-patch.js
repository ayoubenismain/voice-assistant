const SERVER_URL = 'http://localhost:3001/api/retrieval/search';

async function runSearch(query, topK = 5, debug = true) {
  const res = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK, debug }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const tests = [
  {
    label: 'Critical A — English sufficiency',
    query: "Is online registration alone enough?",
    expectedKeyword: 'Remarques importantes',
  },
  {
    label: 'Critical B — English full payment',
    query: "Can I pay all registration fees at once?",
    expectedKeyword: 'Dispositions particulières',
  },
  {
    label: 'Variant — English sufficiency 1',
    query: "Is online registration enough by itself?",
    expectedKeyword: 'Remarques importantes',
  },
  {
    label: 'Variant — English sufficiency 2',
    query: "Is remote registration alone sufficient?",
    expectedKeyword: 'Remarques importantes',
  },
  {
    label: 'Variant — English full payment 1',
    query: "Can I pay everything in one payment?",
    expectedKeyword: 'Dispositions particulières',
  },
  {
    label: 'Variant — English full payment 2',
    query: "Can I pay the whole registration amount at once?",
    expectedKeyword: 'Dispositions particulières',
  },
];

async function run() {
  console.log('\n' + '═'.repeat(80));
  console.log('  ENGLISH MICRO-PATCH TEST');
  console.log('═'.repeat(80));

  let passed = 0;
  for (const test of tests) {
    console.log(`\n▶ [${test.label}]`);
    console.log(`  Query: "${test.query}"`);
    try {
      const res = await runSearch(test.query, 5, true);
      console.log(`  Strategy:   ${res.retrieval.strategy}`);
      console.log(`  Intents:    ${(res.retrieval.detectedIntents || []).join(', ') || 'none'}`);
      console.log(`  ExpansionApplied: ${res.results[0]?.debug?.expansionApplied}`);
      console.log(`  Latency:    ${res.timing.totalMs}ms`);
      console.log('');

      res.results.forEach(r => {
        const d = r.debug || {};
        const status = r.rank === 1 && r.chunk.sectionTitle?.includes(test.expectedKeyword.split(' ')[0]) ? '✅' : (r.rank <= 3 ? '⚠️ ' : '  ');
        console.log(
          `  ${status} Rank ${r.rank} | SemRank=${d.originalRank ?? '-'} semRRF=${(d.semanticRrfContrib??0).toFixed(5)} | ` +
          `LexRank=${d.lexicalRank ?? '-'} lexRRF=${(d.lexicalRrfContrib??0).toFixed(5)} | ` +
          `boost=${(d.intentBoost??0).toFixed(5)} | rrf=${(d.rrfScore??0).toFixed(6)} | "${r.chunk.sectionTitle}"`
        );
      });

      const rank1 = res.results[0];
      const ok = rank1?.chunk.sectionTitle?.includes(test.expectedKeyword.split(' ')[0].substring(0, 8));
      if (ok) { console.log(`  ✅ PASS — "${rank1.chunk.sectionTitle}" is Rank 1`); passed++; }
      else { console.log(`  ❌ FAIL — Expected "${test.expectedKeyword}" but got "${rank1?.chunk.sectionTitle}"`); }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`  TESTS: ${passed}/${tests.length} passed`);
  console.log('═'.repeat(80) + '\n');
}

run().catch(console.error);
