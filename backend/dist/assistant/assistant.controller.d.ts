import { AssistantService } from './assistant.service.js';
import { AskAssistantDto } from './dto/ask-assistant.dto.js';
import { AssistantResponse } from './types/assistant.types.js';
export declare class AssistantController {
    private readonly assistantService;
    constructor(assistantService: AssistantService);
    ask(askDto: AskAssistantDto): Promise<AssistantResponse>;
}
