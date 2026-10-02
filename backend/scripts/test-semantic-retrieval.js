/**
 * Phase 5.5 — Hybrid Retrieval Evaluation Script
 *
 * Run: node scripts/test-semantic-retrieval.js
 * (NestJS server must be running on http://localhost:3001)
 */

const SERVER_URL = 'http://localhost:3001/api/retrieval/search';

const tests = [
  // ── Regression: French ─────────────────────────────────────────────────
  { label: 'REGRESSION — Licence fees FR',  query: "Combien coûtent les frais d'inscription en licence ?", expected: 'Licence fees' },
  { label: 'REGRESSION — Licence fees EN',  query: "How much are the licence registration fees?",          expected: 'Licence fees' },
  // ── Arabizi: How much / fees ──────────────────────────────────────────
  { label: 'Arabizi — 9adeh inscription licence',            query: "9adeh inscription licence?",                    expected: 'Licence fees' },
  { label: 'Arabizi — Ch9adech inscription licence',         query: "Ch9adech inscription licence?",                 expected: 'Licence fees' },
  { label: 'Arabizi — 9adeh ma3loum e tasjil lel license',  query: "9adeh ma3loum e tasjil lel license?",           expected: 'Licence fees' },
  { label: 'Arabizi — Ch9adech n5alles lel licence',         query: "Ch9adech n5alles lel licence?",                 expected: 'Licence fees' },
  { label: 'Arabizi — 9adeh frais mta3 licence',            query: "9adeh frais mta3 licence?",                     expected: 'Licence fees' },
  { label: 'Arabizi — 9adeh n5alles licence',               query: "9adeh n5alles licence?",                        expected: 'Licence fees' },
  { label: 'Arabizi — ch9adech n5alles master',             query: "ch9adech n5alles master?",                      expected: 'Master fees' },
  // ── Arabizi: Dates ───────────────────────────────────────────────────
  { label: 'Arabizi — wa9tech inscription licence',         query: "wa9tech inscription licence?",                  expected: 'Licence dates' },
  { label: 'Arabizi — wa9teh n9ayed licence',              query: "wa9teh n9ayed licence?",                         expected: 'Licence dates' },
  // ── Arabizi: Documents ───────────────────────────────────────────────
  { label: 'Arabizi — chnouma lwra9 mta3 inscription',     query: "chnouma lwra9 mta3 inscription?",               expected: 'Documents' },
  { label: 'Arabizi — chnouma les documents étudiant ancien', query: "chnouma les documents mta3 étudiant ancien?", expected: 'Old student docs' },
  // ── Arabizi: Website / Online ─────────────────────────────────────────
  { label: 'Arabizi — win na3mel inscription en ligne',     query: "win na3mel inscription en ligne?",              expected: 'Website/URL' },
  { label: 'Arabizi — kifeh na3mel inscription',           query: "kifeh na3mel inscription?",                      expected: 'Procedure' },
  // ── Arabizi: Remote registration ─────────────────────────────────────
  { label: 'Arabizi — inscription en ligne wa7adha tekfi', query: "inscription en ligne wa7adha tekfi?",            expected: 'Remote registration sufficiency' },
  // ── Arabizi: Fees by cycle ────────────────────────────────────────────
  { label: 'Arabizi — 9adeh inscription master',           query: "9adeh inscription master?",                     expected: 'Master fees' },
  { label: 'Arabizi — 9adeh inscription prepa',            query: "9adeh inscription prepa?",                      expected: 'Prepa fees' },
  { label: 'Arabizi — ch9adech cycle ingenieur',           query: "ch9adech cycle ingenieur?",                     expected: 'Engineering fees' },
  // ── Arabizi: Spelling variants ─────────────────────────────────────────
  { label: 'Arabizi — 9addech inscription licence',        query: "9addech inscription licence?",                  expected: 'Licence fees' },
  { label: 'Arabizi — ch9addech inscription licence',      query: "ch9addech inscription licence?",                expected: 'Licence fees' },
  { label: 'Arabizi — 9adeh inscription licence w wa9tech n9ayed (multi-intent)',
    query: "9adeh inscription licence w wa9tech n9ayed?",  expected: 'Licence fees + dates' },
  // ── Tunisian Arabic script ────────────────────────────────────────────
  { label: 'Tunisian AR — قداش نخلص في ترسيم الليسانس',  query: "قداش نخلص في ترسيم الليسانس؟",               expected: 'Licence fees' },
  { label: 'Tunisian AR — شنوة معلوم الترسيم لليسانس',  query: "شنوة معلوم الترسيم لليسانس؟",                 expected: 'Licence fees' },
  { label: 'Tunisian AR — وقتاش الترسيم لليسانس',       query: "وقتاش الترسيم لليسانس؟",                       expected: 'Licence dates' },
  { label: 'Tunisian AR — شنوما الأوراق المطلوبة',      query: "شنوما الأوراق المطلوبة؟",                       expected: 'Documents' },
  { label: 'Tunisian AR — وين نعمل الترسيم',             query: "وين نعمل الترسيم؟",                            expected: 'Website' },
  { label: 'Tunisian AR — كيفاش نسجل',                   query: "كيفاش نسجل؟",                                  expected: 'Procedure' },
  // ── Standard Arabic ──────────────────────────────────────────────────
  { label: 'Standard AR — ما هي معاليم التسجيل في الإجازة',  query: "ما هي معاليم التسجيل في الإجازة؟",      expected: 'Licence fees' },
  { label: 'Standard AR — ما هي الوثائق المطلوبة',          query: "ما هي الوثائق المطلوبة للتسجيل؟",         expected: 'Documents' },
  // ── Mixed Darija/French ───────────────────────────────────────────────
  { label: 'Mixed — Chnouma frais inscription licence',    query: "Chnouma frais inscription licence?",             expected: 'Licence fees' },
  { label: 'Mixed — Ch9adech les frais mta3 licence',     query: "Ch9adech les frais mta3 licence?",               expected: 'Licence fees' },
  { label: 'Mixed — Wa9tech inscription licence première année', query: "Wa9tech inscription licence première année?", expected: 'Licence dates' },
  // ── Other cycle fees (French) ─────────────────────────────────────────
  { label: 'Fees FR — Prepa',      query: "Combien coûte le cycle préparatoire ?",              expected: 'Prepa fees' },
  { label: 'Fees FR — Master',     query: "Combien coûte l'inscription en master ?",            expected: 'Master fees' },
  { label: 'Fees FR — Engineering', query: "Combien coûte l'inscription cycle ingénieur ?",    expected: 'Engineering fees' },
  // ── Negative tests ────────────────────────────────────────────────────
  { label: 'NEGATIVE — Weather',   query: "What's the weather tomorrow?",                       expected: 'UNRELATED' },
  { label: 'NEGATIVE — Football',  query: "Who won the football match?",                        expected: 'UNRELATED' },
  { label: 'NEGATIVE — React',     query: "How do I install React?",                            expected: 'UNRELATED' },
  { label: 'NEGATIVE — ESPRIT',    query: "Tell me about ESPRIT",                               expected: 'UNRELATED' },
  // ── Phase 5.6: NUANCED_RULE_QUERIES ──────────────────────────────────
  // Sufficiency
  { label: 'FR Sufficiency', query: "Est-ce que l inscription en ligne suffit à elle seule ?", expected: 'Warning / Remarques importantes' },
  { label: 'EN Sufficiency', query: "Is online registration alone enough?", expected: 'Warning / Remarques importantes' },
  { label: 'Darija Sufficiency 1', query: "inscription en ligne wa7adha tekfi?", expected: 'Warning / Remarques importantes' },
  { label: 'Darija Sufficiency 2', query: "tasjil online wa7dou yekfi?", expected: 'Warning / Remarques importantes' },
  { label: 'Darija Sufficiency 3', query: "ken n9ayed en ligne bark, yekfi?", expected: 'Warning / Remarques importantes' },
  { label: 'Darija Sufficiency 4', query: "inscription à distance bark tekfi?", expected: 'Warning / Remarques importantes' },
  // Full payment
  { label: 'FR Full Payment', query: "Est-ce que je peux payer la totalité des frais d inscription en une seule fois ?", expected: 'Dispositions particulières' },
  { label: 'EN Full Payment', query: "Can I pay all registration fees at once?", expected: 'Dispositions particulières' },
  { label: 'Darija Full Payment 1', query: "najem n5alles inscription kemla mara wa7da?", expected: 'Dispositions particulières' },
  { label: 'Darija Full Payment 2', query: "najem nkhalles kol chay dfa3a wa7da?", expected: 'Dispositions particulières' },
  { label: 'Darija Full Payment 3', query: "n5alles montant kemel mara wa7da?", expected: 'Dispositions particulières' },
  { label: 'Darija Full Payment 4', query: "najjem nخلص الترسيم الكل دفعة واحدة؟", expected: 'Dispositions particulières' },
  // Scholarship
  { label: 'Darija Scholarship 1', query: "ena boursier, n5alles deuxième tranche?", expected: 'Dispositions particulières / Exemption' },
  { label: 'FR Scholarship 1', query: "si je suis boursier, est-ce que je paie le deuxième versement ?", expected: 'Dispositions particulières / Exemption' },
  // Website vs Online Disambiguation
  { label: 'Disambiguation A', query: "win nal9a site inscription?", expected: 'Website / References' },
  { label: 'Disambiguation B', query: "inscription en ligne wa7adha tekfi?", expected: 'Sufficiency / Warning' },
  { label: 'Disambiguation C', query: "quel est le site d'inscription à distance ?", expected: 'Website / References' },
  { label: 'Disambiguation D', query: "l'inscription à distance suffit-elle ?", expected: 'Sufficiency / Warning' },
];

async function runSearch(query, topK = 5, debug = false) {
  const res = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK, debug }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function run() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  Phase 5.5 — Hybrid Retrieval Evaluation (Darija + French + English)`);
  console.log(`${'═'.repeat(80)}\n`);

  for (const test of tests) {
    console.log(`\n▶ [${test.label}]`);
    console.log(`  Query: "${test.query}"`);
    console.log(`  Expected concept: ${test.expected}`);
    try {
      const res = await runSearch(test.query, 5, true);
      console.log(`  Normalized: "${res.retrieval.normalizedQuery}"`);
      console.log(`  Strategy:   ${res.retrieval.strategy}`);
      console.log(`  Intents:    ${(res.retrieval.detectedIntents || []).join(', ') || 'none'}`);
      console.log(`  Latency:    ${res.timing.totalMs}ms (embed: ${res.timing.embeddingMs}ms, search: ${res.timing.searchMs}ms)`);
      if (res.results.length === 0) {
        console.log(`  ❌ No results`);
      } else {
        res.results.forEach(r => {
          const sim = r.similarity?.toFixed(4) ?? '?';
          const rrf = r.debug?.rrfScore?.toFixed(6) ?? '?';
          console.log(`  Rank ${r.rank} | Sim: ${sim} | RRF: ${rrf} | "${r.chunk.sectionTitle || 'No title'}" (Pg: ${r.chunk.pageStart})`);
        });
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  Evaluation complete.');
  console.log(`${'═'.repeat(80)}\n`);
}

run().catch(console.error);
