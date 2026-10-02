import { ConfigService } from '@nestjs/config';
import { AskAssistantDto } from './dto/ask-assistant.dto.js';
import { AssistantResponse } from './types/assistant.types.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { LlmService } from '../llm/llm.service.js';
import { RagContextBuilderService } from '../rag/rag-context-builder.service.js';
import { RagPromptBuilderService } from '../rag/rag-prompt-builder.service.js';
export declare class AssistantService {
    private readonly configService;
    private readonly retrievalService;
    private readonly llmService;
    private readonly ragContextBuilder;
    private readonly ragPromptBuilder;
    private readonly logger;
    private readonly retrievalTopK;
    constructor(configService: ConfigService, retrievalService: RetrievalService, llmService: LlmService, ragContextBuilder: RagContextBuilderService, ragPromptBuilder: RagPromptBuilderService);
    ask(dto: AskAssistantDto): Promise<AssistantResponse>;
}
