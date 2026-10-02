import { LlmMessage } from '../llm/types/llm.types.js';
import { RagPromptContext } from './rag.types.js';
export declare class RagPromptBuilderService {
    buildMessages(context: RagPromptContext): LlmMessage[];
}
