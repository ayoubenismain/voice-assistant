export declare enum RetrievalIntent {
    FEES = "FEES",
    DATES = "DATES",
    DOCUMENTS = "DOCUMENTS",
    WEBSITE = "WEBSITE",
    PROCEDURE = "PROCEDURE",
    PAYMENT = "PAYMENT",
    ACADEMIC_LEVEL = "ACADEMIC_LEVEL",
    GENERAL_REGISTRATION = "GENERAL_REGISTRATION",
    SUFFICIENCY = "SUFFICIENCY",
    REMOTE_REGISTRATION = "REMOTE_REGISTRATION",
    PAYMENT_RULES = "PAYMENT_RULES",
    FULL_PAYMENT = "FULL_PAYMENT",
    INSTALLMENTS = "INSTALLMENTS",
    EXEMPTION = "EXEMPTION"
}
export type NormalizedDarijaQuery = {
    originalQuery: string;
    normalizedQuery: string;
    expansionApplied: boolean;
    detectedIntents: RetrievalIntent[];
    detectedTerms: string[];
};
