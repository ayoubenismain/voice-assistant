export declare class ClarificationContextDto {
    originalQuery: string;
    clarificationQuestion?: string;
}
export declare class AskAssistantDto {
    query: string;
    clarificationContext?: ClarificationContextDto;
    debug?: boolean;
}
