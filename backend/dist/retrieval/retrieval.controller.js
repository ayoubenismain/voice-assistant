var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { RetrievalService } from './retrieval.service.js';
import { SemanticSearchDto } from './dto/semantic-search.dto.js';
let RetrievalController = class RetrievalController {
    retrievalService;
    constructor(retrievalService) {
        this.retrievalService = retrievalService;
    }
    async search(dto) {
        return this.retrievalService.semanticSearch(dto);
    }
};
__decorate([
    Post('search'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SemanticSearchDto]),
    __metadata("design:returntype", Promise)
], RetrievalController.prototype, "search", null);
RetrievalController = __decorate([
    Controller('retrieval'),
    __metadata("design:paramtypes", [RetrievalService])
], RetrievalController);
export { RetrievalController };
//# sourceMappingURL=retrieval.controller.js.map