import { RetrievalIntent } from './darija-normalizer.types.js';
export const DARIJA_PHRASE_LEXICON = [
    {
        variants: [
            'wa7adha tekfi', 'tekfi wa7adha', 'wa7dou yekfi', 'yekfi wa7dou',
            'bark tekfi', 'tekfi bark', 'bark yekfi', 'yekfi bark',
            'suffit à elle seule', 'suffit', 'suffisant', 'uniquement', 'seulement',
            'ken inscription en ligne', 'inscription online bark',
            'alone enough', 'is enough', 'enough by itself', 'by itself',
            'is sufficient', 'sufficient by itself', 'alone suffice', 'by itself suffice',
            'alone sufficient', 'only', 'enough',
            'هل يكفي', 'وحده يكفي', 'كاف', 'هل التسجيل عن بعد كاف', 'التسجيل وحده'
        ],
        expansion: 'suffisant uniquement compléter procédure sans achever',
        intents: [RetrievalIntent.SUFFICIENCY],
    },
    {
        variants: [
            'kemla mara wa7da', 'mara wa7da', 'dfa3a wa7da', 'paiement kemel',
            'kol chay dfa3a wa7da', 'montant kemel',
            'totalité', 'totalité des frais', 'en une seule fois', 'payer tout',
            'paiement total', 'un seul paiement',
            'all at once', /all\s+(.*?)\s+at once/i, /pay\s+(.*?)\s+at once/i, 'pay all at once', 'pay everything at once',
            'pay the full amount', 'pay in one payment', 'pay in a single payment',
            'pay the whole amount', 'pay all fees together', 'pay everything in one go',
            'whole amount at once', 'everything in one payment',
            'كامل', 'كاملا', 'دفعة واحدة', 'دفع كامل', 'المبلغ كاملا'
        ],
        expansion: 'totalité paiement intégral seule fois premier et deuxième versement',
        intents: [RetrievalIntent.FULL_PAYMENT, RetrievalIntent.PAYMENT_RULES],
    },
    {
        variants: [
            'deuxième tranche', 'première tranche', 'deux fois', 'en deux fois',
            '9ost théni', '9ost louel'
        ],
        expansion: 'premier versement deuxième versement tranche',
        intents: [RetrievalIntent.INSTALLMENTS, RetrievalIntent.PAYMENT_RULES],
    },
    {
        variants: [
            'boursier', 'prêt', 'exoneré', 'exonéré', 'إعفاء'
        ],
        expansion: 'exonéré boursier prêt universitaire',
        intents: [RetrievalIntent.EXEMPTION, RetrievalIntent.PAYMENT_RULES],
    },
    {
        variants: [
            'inscription en ligne', 'inscription a distance', 'inscription à distance',
            'tasjil online', 'tasjil en ligne', 'tarsim en ligne', 'tarsim a distance',
            'tarsim عن بعد', 'تسجيل عن بعد'
        ],
        expansion: 'inscription à distance en ligne',
        intents: [RetrievalIntent.REMOTE_REGISTRATION, RetrievalIntent.GENERAL_REGISTRATION],
    }
];
//# sourceMappingURL=darija-phrase-lexicon.js.map