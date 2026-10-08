import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { RetrievalService } from './src/retrieval/retrieval.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const retrievalService = app.get(RetrievalService);

  try {
    const res = await retrievalService.semanticSearch({ query: 'Licence', topK: 5, debug: true });
    console.log("Sources found:", res.results.length);
    console.log("Results:", JSON.stringify(res.results, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }

  await app.close();
}

bootstrap();
