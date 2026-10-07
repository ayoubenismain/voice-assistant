import { RetrievalResultItem } from '../retrieval/types/retrieval-result.type.js';

export interface RagContextSource {
  sourceId: string;
  documentId: string;
  title: string;
  source: string;
  category: string;
  academicYear: string;
  sectionTitle: string;
  pageStart: number;
  pageEnd: number;
  content: string;
}

export interface RagContextResult {
  formattedContext: string;
  sources: RagContextSource[];
}

export interface RagPromptContext {
  originalQuery: string;
  clarificationQuestion?: string;
  clarificationAnswer?: string;
  ragContext: string;
  /** Optional bounded conversation history for continuity context only.
   *  NOT a factual authority — handled by the grounding rule in RagPromptBuilderService. */
  conversationHistory?: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>;
}

