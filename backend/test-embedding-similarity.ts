import { OpenAiEmbeddingProvider } from './src/embeddings/providers/openai.embedding-provider.js';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

// Simple mock for ConfigService
class MockConfigService extends ConfigService {
  get(key: string): any {
    return process.env[key];
  }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function run() {
  console.log('Initializing OpenAI Embedding Provider...');
  
  if (!process.env.EMBEDDING_API_KEY) {
     console.error('EMBEDDING_API_KEY is missing in .env');
     return;
  }
  
  const config = new MockConfigService();
  const provider = new OpenAiEmbeddingProvider(config);

  const sourceText = "Licence. Montant total des frais d'inscription : 70 DT. Premier versement : 40 DT. Deuxième versement : 30 DT.";
  
  const queries = {
    'French (Exact meaning)': "Combien coûtent les frais d'inscription en licence ?",
    'English (Exact meaning)': "How much are the licence registration fees?",
    'Arabic (Exact meaning)': "قداش معلوم الترسيم في الإجازة؟",
    'Arabizi (Exact meaning)': "Ch9adech inscription licence?",
    'Mixed Darija/French (Exact meaning)': "Ch9adech les frais mta3 inscription licence?",
    'Darija variation 1': "9adech inscription licence?",
    'Darija variation 2': "Ch9adech n5alles inscription licence?",
    'Darija variation 3': "Chnouma frais inscription licence?",
    'Darija variation 4': "قداش نخلص في ترسيم الليسانس؟",
    'Unrelated - Procedure': "What is the PFE procedure?",
    'Unrelated - Weather': "What's the weather tomorrow?",
    'Unrelated - Football': "Who won the football match?"
  };

  console.log('Embedding source text...');
  const sourceVec = await provider.embedText(sourceText);

  console.log('\\n--- SIMILARITY RESULTS ---');
  for (const [name, text] of Object.entries(queries)) {
    const vec = await provider.embedText(text);
    const sim = cosineSimilarity(sourceVec, vec);
    console.log(\`\${sim.toFixed(4)} : \${name}\`);
  }
}

run().catch(console.error);
