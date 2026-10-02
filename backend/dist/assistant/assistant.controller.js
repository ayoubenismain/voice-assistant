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
import { AssistantService } from './assistant.service.js';
import { AskAssistantDto } from './dto/ask-assistant.dto.js';
let AssistantController = class AssistantController {
    assistantService;
    constructor(assistantService) {
        this.assistantService = assistantService;
    }
    async ask(askDto) {
        return this.assistantService.ask(askDto);
    }
};
__decorate([
    Post('ask'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [AskAssistantDto]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "ask", null);
AssistantController = __decorate([
    Controller('assistant'),
    __metadata("design:paramtypes", [AssistantService])
], AssistantController);
export { AssistantController };
//# sourceMappingURL=assistant.controller.js.map