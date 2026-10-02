var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
let StorageService = class StorageService {
    storageDir = path.join(process.cwd(), 'storage', 'documents');
    constructor() {
        this.ensureStorageDirectoryExists();
    }
    ensureStorageDirectoryExists() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
        }
        catch (error) {
            console.error('Failed to create storage directory:', error);
        }
    }
    async saveFile(fileName, buffer) {
        const filePath = path.join(this.storageDir, fileName);
        try {
            await fs.promises.writeFile(filePath, buffer);
            return filePath;
        }
        catch (error) {
            throw new InternalServerErrorException('Failed to save file to storage');
        }
    }
    async deleteFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        }
        catch (error) {
            throw new InternalServerErrorException('Failed to delete file from storage');
        }
    }
};
StorageService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], StorageService);
export { StorageService };
//# sourceMappingURL=storage.service.js.map