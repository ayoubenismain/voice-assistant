import { RetrievalIntent } from './darija-normalizer.types.js';

export type LexiconEntry = {
  variants: string[];
  expansion: string;
  intents: RetrievalIntent[];
};

export const DARIJA_LEXICON: LexiconEntry[] = [
  {
    variants: [
      '9adeh', '9adech', '9addech', '9addeh', 'ch9adeh', 'ch9adech', 'ch9addech', 'ch9addeh', 'قداش', 'كم',
      'ma3loum', 'ma3alim', 'm3alim', 'معلوم', 'معاليم', 'رسوم', 'aswem', 'soum'
    ],
    expansion: 'frais montant tarif prix combien',
    intents: [RetrievalIntent.FEES],
  },
  {
    variants: [
      'n5alles', 'nkhales', 'nkhaless', 'n5ales', 'nkhalas', 'نخلص', 'خلص', 'khales'
    ],
    expansion: 'paiement payer versement',
    intents: [RetrievalIntent.PAYMENT, RetrievalIntent.FEES],
  },
  {
    variants: [
      'tasjil', 'tasjel', 'tarsim', 'ترسيم', 'تسجيل', 'n9ayed', 'n9ayad', 'nsajel', 'nsajjel',
      'mta3', 'mte3', 'mta3na',
      'inscription', 'inscrire', 's\'inscrire'
    ],
    expansion: 'inscription',
    intents: [RetrievalIntent.GENERAL_REGISTRATION],
  },
  {
    variants: [
      'wa9tech', 'wa9teh', 'wa9tach', 'w9tech', 'وقتاش', 'متى'
    ],
    expansion: 'date calendrier quand délai',
    intents: [RetrievalIntent.DATES],
  },
  {
    variants: [
      'win', 'وين', 'fina', 'fin', 'site', 'lien', 'url', 'adresse', 'موقع'
    ],
    expansion: 'où lieu site adresse web',
    intents: [RetrievalIntent.WEBSITE],
  },
  {
    variants: [
      'chnouma', 'chnowa', 'chneya', 'chniya', 'شنوما', 'شنوة', 'شنية', 'شنو'
    ],
    expansion: 'quels liste quoi',
    intents: [],
  },
  {
    variants: [
      'wra9', 'wara9', 'awra9', 'lwra9', 'wara9at', 'وراق', 'أوراق', 'وثائق', 'wtheye9', 'wtheyi9'
    ],
    expansion: 'documents pièces dossier',
    intents: [RetrievalIntent.DOCUMENTS],
  },
  {
    variants: [
      'kifeh', 'kifesh', 'كيفاش', 'كيف'
    ],
    expansion: 'comment procédure étapes démarche',
    intents: [RetrievalIntent.PROCEDURE],
  },
  // Academic terms
  {
    variants: [
      'license', 'licence', 'lissans', 'lissan', 'ليسانس', 'إجازة'
    ],
    expansion: 'licence',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'prepa', 'prépa', 'preparatoire', 'préparatoire', 'تحضيري'
    ],
    expansion: 'cycle préparatoire',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'ingenieur', 'ingénieur', 'engineering', 'ing', 'مهندس', 'هندسة'
    ],
    expansion: 'cycle ingénieur',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'master', 'mastère', 'mastere', 'ماجستير', 'ماستر'
    ],
    expansion: 'master',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'ancien', '9dim', '9dom', 'قديم'
    ],
    expansion: 'étudiant ancien',
    intents: [RetrievalIntent.ACADEMIC_LEVEL], // close enough for context
  },
  {
    variants: [
      'jdid', 'jded', 'جديد', 'nouveau'
    ],
    expansion: 'nouveaux étudiants',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'awel', 'loula', '1ere', '1ère', 'أولى'
    ],
    expansion: '1re année première année',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'thania', '2eme', '2ème', 'ثانية'
    ],
    expansion: '2e année deuxième année',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'theltha', '3eme', '3ème', 'ثالثة'
    ],
    expansion: '3e année troisième année',
    intents: [RetrievalIntent.ACADEMIC_LEVEL],
  },
  {
    variants: [
      'ligne', 'enligne', 'internet', 'عن بعد', 'en-ligne', 'online'
    ],
    expansion: 'à distance en ligne',
    intents: [RetrievalIntent.REMOTE_REGISTRATION],
  }
];
