import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticChunkerService } from './semantic-chunker.service.js';

describe('SemanticChunkerService', () => {
  let service: SemanticChunkerService;

  beforeEach(() => {
    service = new SemanticChunkerService();
  });

  // ── Bullet normalization ────────────────────────────────────────────────

  describe('normalizePage', () => {
    it('should normalize PDF bullet artifact \\uf0b7 to hyphen', () => {
      const input = '\uf0b7 First item\n\uf0b7 Second item';
      const result = service.normalizePage(input);
      expect(result).toBe('- First item\n- Second item');
    });

    it('should NOT touch French accents', () => {
      const input = 'frais d\'inscription licence universit\u00e9';
      const result = service.normalizePage(input);
      expect(result).toBe(input);
    });

    it('should NOT modify dates or numbers', () => {
      const input = 'Du 28 ao\u00fbt au 9 septembre 2026. Frais : 70 DT.';
      const result = service.normalizePage(input);
      expect(result).toBe(input);
    });

    it('should NOT modify URLs', () => {
      const input = 'Site : https://issatso.rnu.tn et www.inscription.tn';
      const result = service.normalizePage(input);
      expect(result).toBe(input);
    });

    it('should collapse 4+ blank lines to 3', () => {
      const input = 'A\n\n\n\n\n\nB';
      const result = service.normalizePage(input);
      expect(result).toBe('A\n\n\nB');
    });

    it('should normalize multiple spaces within a line', () => {
      const input = 'Frais   inscription :   70 DT';
      const result = service.normalizePage(input);
      expect(result).toBe('Frais inscription : 70 DT');
    });

    it('should NOT collapse spaces across newlines', () => {
      const input = 'Line one\nLine two';
      expect(service.normalizePage(input)).toBe('Line one\nLine two');
    });
  });

  // ── Heading detection ──────────────────────────────────────────────────

  describe('detectHeadingLevel', () => {
    it('should detect numbered main headings as level 1', () => {
      expect(service.detectHeadingLevel('1. Calendrier d\'inscription')).toBe(1);
      expect(service.detectHeadingLevel('2. Frais d\'inscription')).toBe(1);
      expect(service.detectHeadingLevel('7. R\u00e9f\u00e9rences utiles')).toBe(1);
    });

    it('should detect Etape headings as level 2', () => {
      expect(service.detectHeadingLevel('\u00c9tape 1 - Validation par l\'équipe de sant\u00e9')).toBe(2);
      expect(service.detectHeadingLevel('\u00c9tape 2 - D\u00e9p\u00f4t du dossier administratif')).toBe(2);
    });

    it('should detect known sub-heading prefixes as level 2', () => {
      expect(service.detectHeadingLevel('Licence')).toBe(2);
      expect(service.detectHeadingLevel('Master')).toBe(2);
      expect(service.detectHeadingLevel('Cycle pr\u00e9paratoire scientifique int\u00e9gr\u00e9')).toBe(2);
      expect(service.detectHeadingLevel('Cycle de formation d\'ing\u00e9nieurs')).toBe(2);
      expect(service.detectHeadingLevel('Dispositions particuli\u00e8res relatives aux frais')).toBe(2);
      expect(service.detectHeadingLevel('Nouveaux \u00e9tudiants orient\u00e9s - baccalaur\u00e9at 2026')).toBe(2);
      expect(service.detectHeadingLevel('\u00c9tudiants anciens appartenant d\u00e9j\u00e0 \u00e0 l\'institut')).toBe(2);
    });

    it('should NOT classify regular sentence text as a heading', () => {
      const longSentence = 'Pour l\'ann\u00e9e universitaire 2026-2027, le dossier d\'inscription est compos\u00e9 des pi\u00e8ces suivantes';
      expect(service.detectHeadingLevel(longSentence)).toBe(0);
      expect(service.detectHeadingLevel('Montant total des frais d\'inscription : 70 DT')).toBe(0);
    });

    it('should handle empty text gracefully', () => {
      expect(service.detectHeadingLevel('')).toBe(0);
    });
  });

  // ── Token estimation ───────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('should return 0 for empty text', () => {
      expect(service.estimateTokens('')).toBe(0);
    });

    it('should estimate reasonable token count for a French phrase', () => {
      // "Frais inscription distance cycle formation" = 5 words * 1.33 ~ 7
      const text = 'Frais inscription distance cycle formation';
      const result = service.estimateTokens(text);
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThanOrEqual(12);
    });

    it('should scale proportionally with text length', () => {
      const short = 'Licence frais inscription';
      const doubled = short + ' ' + short;
      const t1 = service.estimateTokens(short);
      const t2 = service.estimateTokens(doubled);
      expect(t2).toBe(t1 * 2);
    });
  });

  // ── Content hashing ────────────────────────────────────────────────────

  describe('hashContent', () => {
    it('should produce a 64-char hex SHA-256 hash', () => {
      const hash = service.hashContent('test content');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be deterministic for the same content', () => {
      const content = 'Frais d\'inscription : 70 DT';
      expect(service.hashContent(content)).toBe(service.hashContent(content));
    });

    it('should differ for different content', () => {
      expect(service.hashContent('A')).not.toBe(service.hashContent('B'));
    });
  });

  // ── Full chunking pipeline ─────────────────────────────────────────────

  describe('chunk', () => {
    it('should return empty array for empty pages input', () => {
      expect(service.chunk([])).toEqual([]);
    });

    it('should produce at least one chunk for minimal content', () => {
      const pages = [
        { pageNumber: 1, text: '1. Section principale\n\nContenu de la section avec plusieurs mots.' },
      ];
      expect(service.chunk(pages).length).toBeGreaterThanOrEqual(1);
    });

    it('should preserve page numbers in chunk metadata', () => {
      const pages = [
        { pageNumber: 1, text: '1. Section A\n\nContenu page un.' },
        { pageNumber: 2, text: '2. Section B\n\nContenu page deux.' },
      ];
      const result = service.chunk(pages);
      const allPages = result.flatMap((c) => [c.pageStart, c.pageEnd]);
      expect(allPages).toContain(1);
      expect(allPages).toContain(2);
    });

    it('should normalize PDF bullets before chunking', () => {
      const pages = [
        { pageNumber: 1, text: '1. Documents requis\n\n\uf0b7 Carte d\'identit\u00e9\n\uf0b7 Photo' },
      ];
      const result = service.chunk(pages);
      const combined = result.map((c) => c.content).join('');
      expect(combined).toContain('- Carte');
      expect(combined).not.toContain('\uf0b7');
    });

    it('should assign a valid content hash to every chunk', () => {
      const pages = [{ pageNumber: 1, text: '1. Test\n\nContenu suffisant pour un chunk.' }];
      service.chunk(pages).forEach((chunk) => {
        expect(chunk.contentHash).toHaveLength(64);
        expect(chunk.contentHash).toMatch(/^[0-9a-f]+$/);
      });
    });

    it('should assign a positive token count to every chunk', () => {
      const pages = [{ pageNumber: 1, text: '1. Test\n\nContenu suffisant pour un chunk.' }];
      service.chunk(pages).forEach((chunk) => {
        expect(chunk.tokenCount).toBeGreaterThan(0);
      });
    });

    it('should be idempotent — same content produces identical hashes', () => {
      const pages = [
        { pageNumber: 1, text: '1. Frais\n\nLicence : 70 DT.\n\n2. Documents\n\nD1 - R\u00e8glement int\u00e9rieur sign\u00e9.' },
      ];
      const r1 = service.chunk(pages);
      const r2 = service.chunk(pages);
      expect(r1.map((c) => c.contentHash)).toEqual(r2.map((c) => c.contentHash));
    });

    it('should not produce chunks exceeding the hard token maximum', () => {
      const words = 'frais inscription \u00e9tudiant universit\u00e9 cycle licence master'.split(' ');
      let longText = '1. Section longue\n\n';
      for (let i = 0; i < 400; i++) {
        longText += words[i % words.length] + ' ';
        if (i % 20 === 19) longText += '\n';
      }
      const pages = [{ pageNumber: 1, text: longText }];
      service.chunk(pages).forEach((chunk) => {
        // Allow a small buffer above HARD_MAX (900) for overlap text
        expect(chunk.tokenCount ?? 0).toBeLessThanOrEqual(950);
      });
    });

    it('should handle cross-page sections correctly', () => {
      const pages = [
        { pageNumber: 2, text: '2. Frais\n\nLicence\n\nMontant total : 70 DT' },
        { pageNumber: 3, text: 'Premier versement : 40 DT\nDeuxi\u00e8me versement : 30 DT' },
      ];
      const result = service.chunk(pages);
      // Some chunk must span or include both pages
      expect(result.some((c) => c.pageStart <= 2 && c.pageEnd >= 3)).toBe(true);
    });

    it('should preserve French accented characters unchanged', () => {
      const pages = [
        { pageNumber: 1, text: '1. R\u00e9f\u00e9rences\n\nLes \u00e9tudiants b\u00e9n\u00e9ficient d\'une exon\u00e9ration des frais.' },
      ];
      const combined = service.chunk(pages).map((c) => c.content).join('');
      expect(combined).toContain('\u00e9tudiants');
      expect(combined).toContain('exon\u00e9ration');
    });

    it('should preserve URLs intact', () => {
      const pages = [
        {
          pageNumber: 6,
          text: '7. R\u00e9f\u00e9rences\n\nSite d\'inscription : www.inscription.tn\nSite web : https://issatso.rnu.tn',
        },
      ];
      const combined = service.chunk(pages).map((c) => c.content).join('');
      expect(combined).toContain('www.inscription.tn');
      expect(combined).toContain('https://issatso.rnu.tn');
    });

    it('should create separate sub-section chunks with combined titles for Licence and Master fee sections', () => {
      const pages = [
        {
          pageNumber: 3,
          text: [
            '2. Frais d\'inscription',
            '',
            'Licence',
            'Montant total : 70 DT. Premier versement : 40 DT.',
            '',
            'Master',
            'Montant total : 150 DT. Premier versement : 80 DT.',
          ].join('\n'),
        },
      ];
      const result = service.chunk(pages);
      const licenceChunk = result.find((c) => c.sectionTitle === '2. Frais d\'inscription > Licence');
      const masterChunk = result.find((c) => c.sectionTitle === '2. Frais d\'inscription > Master');
      expect(licenceChunk).toBeDefined();
      expect(masterChunk).toBeDefined();
      expect(licenceChunk!.content).toContain('70 DT');
      expect(masterChunk!.content).toContain('150 DT');
    });

    it('should handle document with no headings without throwing', () => {
      const pages = [
        { pageNumber: 1, text: 'Texte sans titre. Deuxi\u00e8me phrase. Troisi\u00e8me phrase.' },
      ];
      expect(() => service.chunk(pages)).not.toThrow();
    });

    it('should not emit orphan heading chunks and should merge them forward', () => {
      const pages = [
        {
          pageNumber: 5,
          text: '4. Pi\u00e8ces requises selon le profil de l\u2019\u00e9tudiant\n\nNouveaux \u00e9tudiants orient\u00e9s - baccalaur\u00e9at 2026\nPi\u00e8ces requises : D1.',
        },
      ];
      const result = service.chunk(pages);
      // It should merge the "4. Pièces..." heading into the "Nouveaux étudiants" chunk
      expect(result.length).toBe(1);
      expect(result[0].sectionTitle).toBe('4. Pi\u00e8ces requises selon le profil de l\u2019\u00e9tudiant > Nouveaux \u00e9tudiants orient\u00e9s - baccalaur\u00e9at 2026');
      expect(result[0].content).toContain('4. Pi\u00e8ces requises');
      expect(result[0].content).toContain('Pi\u00e8ces requises : D1.');
    });

    it('should dynamically enrich chunks containing D-codes with their definitions', () => {
      const pages = [
        {
          pageNumber: 1,
          text: 'D1 - R\u00e8glement sign\u00e9.\nD2 - Photos.\nD99 - Inconnu.',
        },
        {
          pageNumber: 2,
          text: '\u00c9tudiants anciens\nPi\u00e8ces requises : D1 et D2 et D5.',
        },
      ];
      const result = service.chunk(pages);
      
      // The definitions chunk should still exist
      const defChunk = result.find(c => c.content.includes('D1 - R\u00e8glement sign\u00e9.'));
      expect(defChunk).toBeDefined();

      // The profile chunk should be enriched
      const profileChunk = result.find(c => c.sectionTitle?.includes('\u00c9tudiants anciens') || c.content.includes('\u00c9tudiants anciens'));
      expect(profileChunk).toBeDefined();
      expect(profileChunk!.content).toContain('D1 - R\u00e8glement sign\u00e9.');
      expect(profileChunk!.content).toContain('D2 - Photos.');
      
      // Unresolved codes (D5) shouldn't invent text
      expect(profileChunk!.content).not.toContain('D5 -');
      
      // The source metadata (pageEnd) should remain valid
      expect(profileChunk!.pageStart).toBe(2);
    });
  });
});
