import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
export declare class DocumentsService {
    private readonly prisma;
    private readonly storageService;
    private readonly MAX_FILE_SIZE;
    constructor(prisma: PrismaService, storageService: StorageService);
    uploadDocument(file: any, body: any): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getAllDocuments(): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    getDocumentById(id: string): Promise<{
        id: string;
        checksum: string;
        title: string;
        category: string | null;
        academicYear: string | null;
        department: string | null;
        source: string | null;
        fileName: string;
        mimeType: string;
        storagePath: string | null;
        status: import("@prisma/client").$Enums.DocumentStatus;
        createdAt: Date;
        updatedAt: Date;
    }>;
    deleteDocument(id: string): Promise<{
        message: string;
    }>;
}
