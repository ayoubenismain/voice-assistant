import { ConfigService } from '@nestjs/config';
import { RetrievalResultItem } from '../retrieval/types/retrieval-result.type.js';
import { RagContextResult } from './rag.types.js';
export declare class RagContextBuilderService {
    private readonly configService;
    private readonly maxChunks;
    private readonly maxChars;
    constructor(configService: ConfigService);
    buildContext(retrievedChunks: RetrievalResultItem[]): RagContextResult;
}
