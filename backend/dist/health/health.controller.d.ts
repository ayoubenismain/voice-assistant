import { PrismaService } from '../prisma/prisma.service.js';
export declare class HealthController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    checkHealth(): Promise<{
        status: string;
        database: string;
    }>;
}
