var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import { DARIJA_LEXICON } from './darija-lexicon.js';
import { DARIJA_PHRASE_LEXICON } from './darija-phrase-lexicon.js';
let DarijaNormalizerService = class DarijaNormalizerService {
    normalize(query) {
        const originalQuery = query.trim();
        if (!originalQuery) {
            return {
                originalQuery: '',
                normalizedQuery: '',
                expansionApplied: false,
                detectedIntents: [],
                detectedTerms: [],
            };
        }
        let currentQuery = originalQuery.toLowerCase();
        const detectedIntents = new Set();
        const detectedTerms = new Set();
        const expansionTerms = new Set();
        let phraseMatched = false;
        for (const entry of DARIJA_PHRASE_LEXICON) {
            for (const variant of entry.variants) {
                let matched = false;
                let matchedStr = '';
                if (typeof variant === 'string' && currentQuery.includes(variant)) {
                    matched = true;
                    matchedStr = variant;
                }
                else if (variant instanceof RegExp) {
                    const match = currentQuery.match(variant);
                    if (match) {
                        matched = true;
                        matchedStr = match[0];
                    }
                }
                if (matched) {
                    entry.intents.forEach(i => detectedIntents.add(i));
                    detectedTerms.add(matchedStr);
                    const expWords = entry.expansion.split(' ');
                    expWords.forEach(w => expansionTerms.add(w));
                    if (typeof variant === 'string') {
                        currentQuery = currentQuery.replace(new RegExp(variant, 'g'), '');
                    }
                    else {
                        currentQuery = currentQuery.replace(variant, '');
                    }
                    phraseMatched = true;
                    break;
                }
            }
        }
        const tokens = currentQuery.replace(/[.,!?؟]/g, ' ').split(/\s+/).filter(t => t.length > 0);
        let tokenMatched = false;
        for (const token of tokens) {
            let matched = false;
            for (const entry of DARIJA_LEXICON) {
                if (entry.variants.includes(token)) {
                    entry.intents.forEach(i => detectedIntents.add(i));
                    detectedTerms.add(token);
                    const expWords = entry.expansion.split(' ');
                    expWords.forEach(w => expansionTerms.add(w));
                    matched = true;
                    tokenMatched = true;
                    break;
                }
            }
            if (!matched && token.length > 2) {
                expansionTerms.add(token);
            }
        }
        const normalizedQuery = Array.from(expansionTerms).join(' ').trim();
        const hasMeaningfulExpansion = (phraseMatched || tokenMatched) && (normalizedQuery !== originalQuery.toLowerCase());
        const frenchStopWords = ['est-ce', 'que', 'le', 'la', 'les', 'un', 'une', 'des', 'pour', 'dans', 'sur', 'avec', 'et'];
        const englishStopWords = [' is ', ' can ', ' the ', ' do ', ' does ', ' how ', ' what ', ' when ', ' are ', ' to ', ' in ', ' at ', ' i ', ' my ', ' me '];
        const lowerOrig = originalQuery.toLowerCase();
        const isMostlyFrench = frenchStopWords.filter(w => lowerOrig.includes(w)).length >= 2;
        const paddedOrig = ` ${lowerOrig.replace(/[.,!?؟]/g, ' ')} `;
        const isMostlyEnglish = englishStopWords.filter(w => paddedOrig.includes(w)).length >= 1;
        const isMostlyStandardLang = isMostlyFrench || isMostlyEnglish;
        const hasArabizi = /[0-9]/.test(originalQuery.replace(/[0-9]+(dt|\s*dt|eme|ème|ere|ère|e|st|nd|rd|th)/ig, ''));
        const hasArabicScript = /[\u0600-\u06FF]/.test(originalQuery);
        let expansionApplied = false;
        if (phraseMatched || tokenMatched) {
            if (hasArabizi || hasArabicScript) {
                expansionApplied = true;
            }
            else if (!isMostlyStandardLang && normalizedQuery !== lowerOrig) {
                expansionApplied = true;
            }
            else if (isMostlyStandardLang && lowerOrig.includes('wa7adha')) {
                expansionApplied = true;
            }
        }
        return {
            originalQuery,
            normalizedQuery,
            expansionApplied,
            detectedIntents: Array.from(detectedIntents),
            detectedTerms: Array.from(detectedTerms),
        };
    }
};
DarijaNormalizerService = __decorate([
    Injectable()
], DarijaNormalizerService);
export { DarijaNormalizerService };
//# sourceMappingURL=darija-normalizer.service.js.map