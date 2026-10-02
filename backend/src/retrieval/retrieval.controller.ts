import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { RetrievalService } from './retrieval.service.js';
import { SemanticSearchDto } from './dto/semantic-search.dto.js';
import { SemanticSearchResponse } from './types/retrieval-result.type.js';

@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(@Body() dto: SemanticSearchDto): Promise<SemanticSearchResponse> {
    return this.retrievalService.semanticSearch(dto);
  }
}
