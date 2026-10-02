import { Injectable } from '@nestjs/common';
import { NormalizedDarijaQuery, RetrievalIntent } from './darija-normalizer.types.js';
import { DARIJA_LEXICON } from './darija-lexicon.js';
import { DARIJA_PHRASE_LEXICON } from './darija-phrase-lexicon.js';

@Injectable()
export class DarijaNormalizerService {
  
  normalize(query: string): NormalizedDarijaQuery {
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
    
    const detectedIntents = new Set<RetrievalIntent>();
    const detectedTerms = new Set<string>();
    const expansionTerms = new Set<string>();

    let phraseMatched = false;

    // 1. Phrase matching
    for (const entry of DARIJA_PHRASE_LEXICON) {
      for (const variant of entry.variants) {
        let matched = false;
        let matchedStr = '';
        
        if (typeof variant === 'string' && currentQuery.includes(variant)) {
          matched = true;
          matchedStr = variant;
        } else if (variant instanceof RegExp) {
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
          
          // Remove the matched phrase so we don't re-process its tokens
          if (typeof variant === 'string') {
            currentQuery = currentQuery.replace(new RegExp(variant, 'g'), '');
          } else {
            currentQuery = currentQuery.replace(variant, '');
          }
          
          phraseMatched = true;
          break; // move to next entry
        }
      }
    }

    // 2. Token matching
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
    
    // We only consider expansion applied if we matched phrase or token, 
    // AND if there's actually a substantial difference that adds value.
    // E.g. purely French query will not hit many tokens unless it hits something that translates it differently.
    // Let's rely on phraseMatched or tokenMatched to set expansionApplied, but also check for typical Arabizi.
    
    // If the original already contains the expansions, it was just French.
    const hasMeaningfulExpansion = (phraseMatched || tokenMatched) && (normalizedQuery !== originalQuery.toLowerCase());
    
    // For queries like "Est-ce que l inscription en ligne suffit à elle seule ?", 
    // "en ligne" matches phrase and adds "à distance en ligne" but the intent is SUFFICIENCY because of "suffit à elle seule".
    // Wait, if it's already French, BGE-M3 handles it.
    // But we might want the intent detected. So we still detect intents but we can set expansionApplied = false 
    // so we don't run a redundant vector search.
    
    // Let's decide expansionApplied based on whether we replaced something that wasn't already mostly there,
    // or just if we matched specific Darija/Arabizi things.
    // For now, if tokenMatched or phraseMatched is true, but the query was mostly French, the expanded query
    // might just be a jumbled version. 
    // Let's say expansion is needed if we detect intents? No, intent can be detected but expansion skipped.
    
    // Let's use a heuristic: if we replaced more than 1 term, or if the matched term was explicitly Arabizi.
    // But how to know if it's Arabizi? 
    // If we just check if normalizedQuery has length > 0 and is significantly different.
    // Let's just say expansionApplied = hasMeaningfulExpansion.
    // We can also skip expansion if the query has many French stop words: "est-ce", "que", "le", "la", "les".
    
    const frenchStopWords = ['est-ce', 'que', 'le', 'la', 'les', 'un', 'une', 'des', 'pour', 'dans', 'sur', 'avec', 'et'];
    const englishStopWords = [' is ', ' can ', ' the ', ' do ', ' does ', ' how ', ' what ', ' when ', ' are ', ' to ', ' in ', ' at ', ' i ', ' my ', ' me '];
    
    const lowerOrig = originalQuery.toLowerCase();
    
    // Check if mostly French or English
    const isMostlyFrench = frenchStopWords.filter(w => lowerOrig.includes(w)).length >= 2;
    const paddedOrig = ` ${lowerOrig.replace(/[.,!?؟]/g, ' ')} `;
    const isMostlyEnglish = englishStopWords.filter(w => paddedOrig.includes(w)).length >= 1;
    
    const isMostlyStandardLang = isMostlyFrench || isMostlyEnglish;
    
    // If it's mostly French/English, and we didn't add any Arabic-specific meaning, skip expansion
    // (BGE-M3 is already good at these languages).
    // If we matched something like "9adeh", it's Arabizi.
    const hasArabizi = /[0-9]/.test(originalQuery.replace(/[0-9]+(dt|\s*dt|eme|ème|ere|ère|e|st|nd|rd|th)/ig, '')); // rough check for 9adeh, ch9adech
    const hasArabicScript = /[\u0600-\u06FF]/.test(originalQuery);

    let expansionApplied = false;
    
    if (phraseMatched || tokenMatched) {
      if (hasArabizi || hasArabicScript) {
        expansionApplied = true;
      } else if (!isMostlyStandardLang && normalizedQuery !== lowerOrig) {
        expansionApplied = true;
      } else if (isMostlyStandardLang && lowerOrig.includes('wa7adha')) {
        expansionApplied = true;
      }
    }
    
    // If we detected intents, keep them even if expansionApplied is false, because the intents are used for RRF boost!
    
    return {
      originalQuery,
      normalizedQuery,
      expansionApplied,
      detectedIntents: Array.from(detectedIntents),
      detectedTerms: Array.from(detectedTerms),
    };
  }
}
