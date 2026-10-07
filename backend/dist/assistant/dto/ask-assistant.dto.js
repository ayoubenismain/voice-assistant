var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsString, IsOptional, IsBoolean, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
export class ClarificationContextDto {
    originalQuery;
    clarificationQuestion;
}
__decorate([
    IsString(),
    MaxLength(1000),
    __metadata("design:type", String)
], ClarificationContextDto.prototype, "originalQuery", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(1000),
    __metadata("design:type", String)
], ClarificationContextDto.prototype, "clarificationQuestion", void 0);
export class AskAssistantDto {
    query;
    userId;
    clarificationContext;
    debug;
}
__decorate([
    IsString(),
    MaxLength(1000),
    __metadata("design:type", String)
], AskAssistantDto.prototype, "query", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(256),
    __metadata("design:type", String)
], AskAssistantDto.prototype, "userId", void 0);
__decorate([
    IsOptional(),
    ValidateNested(),
    Type(() => ClarificationContextDto),
    __metadata("design:type", ClarificationContextDto)
], AskAssistantDto.prototype, "clarificationContext", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], AskAssistantDto.prototype, "debug", void 0);
//# sourceMappingURL=ask-assistant.dto.js.map