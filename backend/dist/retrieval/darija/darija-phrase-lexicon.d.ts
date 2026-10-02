import { RetrievalIntent } from './darija-normalizer.types.js';
export type PhraseLexiconEntry = {
    variants: (string | RegExp)[];
    expansion: string;
    intents: RetrievalIntent[];
};
export declare const DARIJA_PHRASE_LEXICON: PhraseLexiconEntry[];
