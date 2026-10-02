import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly storageDir = path.join(process.cwd(), 'storage', 'documents');

  constructor() {
    this.ensureStorageDirectoryExists();
  }

  private ensureStorageDirectoryExists() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create storage directory:', error);
    }
  }

  async saveFile(fileName: string, buffer: Buffer): Promise<string> {
    const filePath = path.join(this.storageDir, fileName);
    try {
      await fs.promises.writeFile(filePath, buffer);
      return filePath;
    } catch (error) {
      throw new InternalServerErrorException('Failed to save file to storage');
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete file from storage');
    }
  }
}
