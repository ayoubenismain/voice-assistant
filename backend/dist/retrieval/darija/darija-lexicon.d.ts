import { RetrievalIntent } from './darija-normalizer.types.js';
export type LexiconEntry = {
    variants: string[];
    expansion: string;
    intents: RetrievalIntent[];
};
export declare const DARIJA_LEXICON: LexiconEntry[];
