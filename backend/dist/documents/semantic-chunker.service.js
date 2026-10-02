var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
const TARGET_MAX_TOKENS = 600;
const HARD_MAX_TOKENS = 800;
const MIN_CHUNK_TOKENS = 20;
const OVERLAP_TOKENS = 60;
const PDF_BULLET = '\uf0b7';
const MAIN_HEADING_RE = /^\d+\.\s+\S/;
const STEP_HEADING_RE = /^Étape\s+\d+\s*[-–]/i;
const SUB_HEADING_PREFIXES = [
    'Licence',
    'Master',
    'Cycle préparatoire',
    'Cycle de formation',
    'Dispositions particulières',
    'Nouveaux étudiants',
    'Étudiants anciens',
    'Étudiants admis',
    'Étudiants dont',
    'Pour les étudiants',
    '1re année de licence',
    '2e année de licence',
    '3e année de licence',
    '1re année du cycle préparatoire',
    '2e année du cycle préparatoire',
    '1re année du cycle de formation',
    '2e année du cycle de formation',
    '3e année du cycle de formation',
    '4e année du cycle de formation',
    '5e année du cycle de formation',
    '1re année de licence - nouveaux',
    '1re année de licence - anciens',
    '1re année',
    '2e année',
    '3e année',
    '4e année',
    '5e année',
];
let SemanticChunkerService = class SemanticChunkerService {
    chunk(pages) {
        if (pages.length === 0)
            return [];
        const blocks = this.buildAnnotatedBlocks(pages);
        const sections = this.groupIntoSections(blocks);
        const rawDrafts = this.sectionsToRawDrafts(sections);
        const dictionary = this.extractReferenceCodes(rawDrafts);
        this.enrichWithReferenceCodes(rawDrafts, dictionary);
        const cleaned = this.mergeTinyHeadings(rawDrafts);
        return cleaned.map((d) => this.finalizeDraft(d));
    }
    buildAnnotatedBlocks(pages) {
        const allBlocks = [];
        for (const page of pages) {
            const normalized = this.normalizePage(page.text);
            const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
            for (const para of paragraphs) {
                const subBlocks = this.splitAtEmbeddedHeadings(para);
                for (const sub of subBlocks) {
                    const headingLevel = this.detectHeadingLevel(sub);
                    allBlocks.push({
                        text: sub,
                        pageStart: page.pageNumber,
                        pageEnd: page.pageNumber,
                        headingLevel,
                    });
                }
            }
        }
        return allBlocks;
    }
    splitAtEmbeddedHeadings(para) {
        const lines = para.split('\n');
        const blocks = [];
        let currentLines = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentLines.length > 0)
                    currentLines.push(line);
                continue;
            }
            const isHeading = this.detectHeadingLevel(trimmed) > 0;
            if (isHeading && currentLines.length > 0) {
                const flushed = currentLines.join('\n').trim();
                if (flushed)
                    blocks.push(flushed);
                currentLines = [trimmed];
            }
            else {
                currentLines.push(line);
            }
        }
        if (currentLines.length > 0) {
            const flushed = currentLines.join('\n').trim();
            if (flushed)
                blocks.push(flushed);
        }
        return blocks.length > 0 ? blocks : [para];
    }
    normalizePage(text) {
        let result = text;
        result = result.replace(/\uf0b7/g, '-');
        result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        result = result.replace(/\n{4,}/g, '\n\n\n');
        result = result
            .split('\n')
            .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
            .join('\n');
        return result.trim();
    }
    detectHeadingLevel(text) {
        const firstLine = text.split('\n')[0].trim();
        if (MAIN_HEADING_RE.test(firstLine))
            return 1;
        if (STEP_HEADING_RE.test(firstLine))
            return 2;
        if (firstLine.length < 90 && SUB_HEADING_PREFIXES.some((p) => firstLine.startsWith(p))) {
            return 2;
        }
        return 0;
    }
    groupIntoSections(blocks) {
        const sections = [];
        let currentSection = null;
        for (const block of blocks) {
            if (block.headingLevel === 1) {
                if (currentSection)
                    sections.push(currentSection);
                currentSection = {
                    title: this.extractFirstLine(block.text),
                    blocks: [block],
                    pageStart: block.pageStart,
                    pageEnd: block.pageEnd,
                };
            }
            else {
                if (!currentSection) {
                    currentSection = {
                        title: null,
                        blocks: [],
                        pageStart: block.pageStart,
                        pageEnd: block.pageEnd,
                    };
                }
                currentSection.blocks.push(block);
                currentSection.pageEnd = Math.max(currentSection.pageEnd, block.pageEnd);
            }
        }
        if (currentSection)
            sections.push(currentSection);
        return sections;
    }
    sectionsToRawDrafts(sections) {
        const drafts = [];
        for (const section of sections) {
            const subSectionDrafts = this.sectionToSubSectionDrafts(section);
            drafts.push(...subSectionDrafts);
        }
        return this.mergeOrphanDrafts(drafts);
    }
    sectionToSubSectionDrafts(section) {
        const result = [];
        let subTitle = section.title;
        let subBlocks = [];
        const flushSub = () => {
            if (subBlocks.length === 0)
                return;
            const content = subBlocks.map((b) => b.text).join('\n\n');
            const pageStart = subBlocks[0].pageStart;
            const pageEnd = subBlocks[subBlocks.length - 1].pageEnd;
            let combinedTitle = subTitle;
            if (section.title && subTitle && section.title !== subTitle) {
                combinedTitle = section.title + ' > ' + subTitle;
            }
            const sized = this.splitBySize(content, combinedTitle, pageStart, pageEnd);
            result.push(...sized);
            subBlocks = [];
        };
        for (const block of section.blocks) {
            if (block.headingLevel === 2) {
                flushSub();
                subTitle = this.extractFirstLine(block.text);
                const lines = block.text.split('\n');
                const bodyAfterHeading = lines.slice(1).join('\n').trim();
                if (bodyAfterHeading) {
                    subBlocks.push({ ...block, text: bodyAfterHeading, headingLevel: 0 });
                }
            }
            else {
                subBlocks.push(block);
            }
        }
        flushSub();
        return result;
    }
    splitBySize(content, sectionTitle, pageStart, pageEnd) {
        const tokens = this.estimateTokens(content);
        if (tokens <= HARD_MAX_TOKENS) {
            return [{ content, sectionTitle, pageStart, pageEnd }];
        }
        const paragraphs = content.split(/\n{2,}/);
        const chunks = [];
        let current = [];
        let currentTokens = 0;
        let overlapBuffer = '';
        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraTokens = this.estimateTokens(para);
            if (currentTokens + paraTokens > TARGET_MAX_TOKENS && current.length > 0) {
                const chunkContent = (overlapBuffer ? overlapBuffer + '\n\n' : '') + current.join('\n\n');
                chunks.push({ content: chunkContent, sectionTitle, pageStart, pageEnd });
                overlapBuffer = this.buildOverlap(current.join('\n\n'));
                current = [para];
                currentTokens = paraTokens;
            }
            else {
                current.push(para);
                currentTokens += paraTokens;
            }
        }
        if (current.length > 0) {
            const chunkContent = (overlapBuffer ? overlapBuffer + '\n\n' : '') + current.join('\n\n');
            chunks.push({ content: chunkContent, sectionTitle, pageStart, pageEnd });
        }
        return chunks.length > 0 ? chunks : [{ content, sectionTitle, pageStart, pageEnd }];
    }
    mergeOrphanDrafts(drafts) {
        if (drafts.length === 0)
            return [];
        const result = [drafts[0]];
        for (let i = 1; i < drafts.length; i++) {
            const current = drafts[i];
            const prev = result[result.length - 1];
            const tokens = this.estimateTokens(current.content);
            const canMerge = tokens < MIN_CHUNK_TOKENS &&
                (current.sectionTitle === null || current.sectionTitle === prev.sectionTitle);
            if (canMerge) {
                result[result.length - 1] = {
                    content: prev.content + '\n\n' + current.content,
                    sectionTitle: prev.sectionTitle,
                    pageStart: prev.pageStart,
                    pageEnd: Math.max(prev.pageEnd, current.pageEnd),
                };
            }
            else {
                result.push(current);
            }
        }
        return result;
    }
    mergeTinyHeadings(drafts) {
        const result = [];
        for (let i = 0; i < drafts.length; i++) {
            const draft = drafts[i];
            const tokens = this.estimateTokens(draft.content);
            const isTinyHeading = tokens < 25 && (!draft.content.includes('\n') || draft.content.trim() === draft.sectionTitle?.trim());
            if (isTinyHeading && i + 1 < drafts.length) {
                drafts[i + 1].content = draft.content + '\n\n' + drafts[i + 1].content;
                drafts[i + 1].pageStart = Math.min(drafts[i + 1].pageStart, draft.pageStart);
                if (draft.sectionTitle && drafts[i + 1].sectionTitle !== draft.sectionTitle) {
                    if (drafts[i + 1].sectionTitle) {
                        if (!drafts[i + 1].sectionTitle.startsWith(draft.sectionTitle + ' > ')) {
                            drafts[i + 1].sectionTitle = draft.sectionTitle + ' > ' + drafts[i + 1].sectionTitle;
                        }
                    }
                    else {
                        drafts[i + 1].sectionTitle = draft.sectionTitle;
                    }
                }
            }
            else {
                result.push(draft);
            }
        }
        return result;
    }
    extractReferenceCodes(drafts) {
        const dictionary = new Map();
        for (const draft of drafts) {
            const regex = /^(D\d+)\s*[-–]\s*(.+)$/gm;
            let match;
            while ((match = regex.exec(draft.content)) !== null) {
                dictionary.set(match[1], match[0].trim());
            }
        }
        return dictionary;
    }
    enrichWithReferenceCodes(drafts, dictionary) {
        if (dictionary.size === 0)
            return;
        for (const draft of drafts) {
            const mentionedCodes = new Set();
            const regex = /\b(D\d+)\b/g;
            let match;
            while ((match = regex.exec(draft.content)) !== null) {
                mentionedCodes.add(match[1]);
            }
            if (mentionedCodes.size > 0) {
                let addedCount = 0;
                let enrichment = '\n\nDéfinitions des références :';
                const sortedCodes = Array.from(mentionedCodes).sort((a, b) => {
                    const numA = parseInt(a.replace('D', ''), 10);
                    const numB = parseInt(b.replace('D', ''), 10);
                    return numA - numB;
                });
                for (const code of sortedCodes) {
                    const def = dictionary.get(code);
                    if (def && !draft.content.includes(def)) {
                        enrichment += '\n' + def;
                        addedCount++;
                    }
                }
                if (addedCount > 0) {
                    draft.content += enrichment;
                }
            }
        }
    }
    finalizeDraft(draft) {
        return {
            ...draft,
            tokenCount: this.estimateTokens(draft.content),
            contentHash: this.hashContent(draft.content),
        };
    }
    estimateTokens(text) {
        const wordCount = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
        return Math.ceil(wordCount * 1.33);
    }
    buildOverlap(text) {
        const words = text.split(/\s+/);
        const overlapWords = Math.ceil(OVERLAP_TOKENS / 1.33);
        const slice = words.slice(-overlapWords).join(' ');
        return `[...] ${slice}`;
    }
    extractFirstLine(text) {
        return text.split('\n')[0].trim();
    }
    hashContent(content) {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
};
SemanticChunkerService = __decorate([
    Injectable()
], SemanticChunkerService);
export { SemanticChunkerService };
//# sourceMappingURL=semantic-chunker.service.js.map