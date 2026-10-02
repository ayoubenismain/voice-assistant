var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
let DocumentsService = class DocumentsService {
    prisma;
    storageService;
    MAX_FILE_SIZE = 10 * 1024 * 1024;
    constructor(prisma, storageService) {
        this.prisma = prisma;
        this.storageService = storageService;
    }
    async uploadDocument(file, body) {
        if (!file) {
            throw new BadRequestException('File is required');
        }
        if (file.mimetype !== 'application/pdf') {
            throw new BadRequestException('Only PDF files are supported for now');
        }
        if (file.size > this.MAX_FILE_SIZE) {
            throw new BadRequestException(`File size exceeds the limit of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`);
        }
        const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const existingDoc = await this.prisma.document.findUnique({
            where: { checksum },
        });
        if (existingDoc) {
            throw new ConflictException(`Duplicate document detected (ID: ${existingDoc.id})`);
        }
        const originalExt = path.extname(file.originalname);
        const internalFileName = `${uuidv4()}${originalExt}`;
        const storagePath = await this.storageService.saveFile(internalFileName, file.buffer);
        const document = await this.prisma.document.create({
            data: {
                title: body.title || file.originalname,
                category: body.category || null,
                academicYear: body.academicYear || null,
                department: body.department || null,
                source: body.source || null,
                fileName: file.originalname,
                mimeType: file.mimetype,
                storagePath: storagePath,
                checksum: checksum,
                status: 'UPLOADED',
            },
        });
        return document;
    }
    async getAllDocuments() {
        return this.prisma.document.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }
    async getDocumentById(id) {
        const document = await this.prisma.document.findUnique({
            where: { id },
        });
        if (!document) {
            throw new NotFoundException(`Document with ID ${id} not found`);
        }
        return document;
    }
    async deleteDocument(id) {
        const document = await this.getDocumentById(id);
        await this.prisma.document.delete({
            where: { id },
        });
        if (document.storagePath) {
            await this.storageService.deleteFile(document.storagePath);
        }
        return { message: `Document ${id} successfully deleted` };
    }
};
DocumentsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        StorageService])
], DocumentsService);
export { DocumentsService };
//# sourceMappingURL=documents.service.js.map