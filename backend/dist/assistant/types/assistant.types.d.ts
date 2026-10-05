import { RagContextSource } from '../../rag/rag.types.js';
export interface AssistantTiming {
    retrievalMs: number;
    contextBuildMs: number;
    generationMs: number;
    totalMs: number;
}
export interface AssistantResponse {
    type: 'answer' | 'clarification' | 'no_verified_info' | 'out_of_scope';
    query: string;
    answer?: string;
    clarification?: {
        question: string;
        options: string[];
        context: {
            originalQuery: string;
        };
    };
    sources: RagContextSource[];
    timing: AssistantTiming;
    debug?: any;
}
