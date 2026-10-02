export declare class StorageService {
    private readonly storageDir;
    constructor();
    private ensureStorageDirectoryExists;
    saveFile(fileName: string, buffer: Buffer): Promise<string>;
    deleteFile(filePath: string): Promise<void>;
}
