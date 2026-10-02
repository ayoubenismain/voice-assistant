var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
let MockEmbeddingProvider = class MockEmbeddingProvider {
    getProviderName() {
        return 'mock';
    }
    getModelName() {
        return 'mock-bge-m3-1024';
    }
    getDimensions() {
        return 1024;
    }
    async embedText(text) {
        const result = await this.embedTexts([text]);
        return result[0];
    }
    async embedTexts(texts) {
        if (texts.length === 0)
            return [];
        return texts.map((text) => {
            const vector = new Array(1024).fill(0);
            vector[0] = text.length / 1000;
            vector[1] = text.includes('Licence') ? 1.0 : 0.0;
            vector[2] = text.includes('inscription') ? 1.0 : 0.0;
            return vector;
        });
    }
};
MockEmbeddingProvider = __decorate([
    Injectable()
], MockEmbeddingProvider);
export { MockEmbeddingProvider };
//# sourceMappingURL=mock.embedding-provider.js.map