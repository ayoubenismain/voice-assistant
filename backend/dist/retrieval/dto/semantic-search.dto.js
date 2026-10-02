var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
export class SemanticSearchDto {
    query;
    topK = 5;
    debug = false;
}
__decorate([
    IsString(),
    IsNotEmpty(),
    __metadata("design:type", String)
], SemanticSearchDto.prototype, "query", void 0);
__decorate([
    IsOptional(),
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(20),
    __metadata("design:type", Number)
], SemanticSearchDto.prototype, "topK", void 0);
__decorate([
    IsOptional(),
    __metadata("design:type", Boolean)
], SemanticSearchDto.prototype, "debug", void 0);
//# sourceMappingURL=semantic-search.dto.js.map