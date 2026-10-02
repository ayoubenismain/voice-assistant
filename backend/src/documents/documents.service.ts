import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async uploadDocument(file: any, body: any) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported for now');
    }

    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds the limit of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Calculate checksum to detect duplicates
    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

    const existingDoc = await this.prisma.document.findUnique({
      where: { checksum },
    });

    if (existingDoc) {
      throw new ConflictException(`Duplicate document detected (ID: ${existingDoc.id})`);
    }

    const originalExt = path.extname(file.originalname);
    const internalFileName = `${uuidv4()}${originalExt}`;

    // Save to storage
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

  async getDocumentById(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }

    return document;
  }

  async deleteDocument(id: string) {
    const document = await this.getDocumentById(id);

    // Remove from DB first
    await this.prisma.document.delete({
      where: { id },
    });

    // Remove from storage
    if (document.storagePath) {
      await this.storageService.deleteFile(document.storagePath);
    }

    return { message: `Document ${id} successfully deleted` };
  }
}
