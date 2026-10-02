import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

// pdf-parse@1.x is a CJS module that exports a single function.
// We use createRequire to load it correctly from an ESM context.
const requireCjs = createRequire(import.meta.url);
const pdfParse: (buf: Buffer, opts?: any) => Promise<any> = requireCjs('pdf-parse');

export interface ExtractedPage {
  pageNumber: number;
  rawText: string;
  normalizedText: string;
}

export interface ExtractionResult {
  success: boolean;
  pages: ExtractedPage[];
  pageCount: number;
  error?: string;
  errorCode?: string;
}

@Injectable()
export class PdfExtractionService {
  private readonly logger = new Logger(PdfExtractionService.name);

  // Minimum total chars to be considered "extractable"
  private readonly MIN_TEXT_THRESHOLD = 20;

  async extractPages(storagePath: string): Promise<ExtractionResult> {
    // 1. Resolve absolute path — never trust user-supplied paths
    const resolvedPath = path.resolve(storagePath);

    // 2. Check file existence
    if (!fs.existsSync(resolvedPath)) {
      this.logger.error(`PDF file not found at: ${resolvedPath}`);
      return {
        success: false,
        pages: [],
        pageCount: 0,
        error: `File not found: ${resolvedPath}`,
        errorCode: 'PDF_FILE_NOT_FOUND',
      };
    }

    let dataBuffer: Buffer;
    try {
      dataBuffer = await fs.promises.readFile(resolvedPath);
    } catch (err) {
      this.logger.error(`Failed to read PDF file: ${err}`);
      return {
        success: false,
        pages: [],
        pageCount: 0,
        error: 'Could not read PDF file from disk',
        errorCode: 'PDF_FILE_NOT_FOUND',
      };
    }

    // 3. Parse PDF preserving per-page text via pagerender callback
    const pageTexts: string[] = [];

    const options = {
      // Invoked once per page by pdf-parse/pdf.js
      pagerender: (pageData: any): Promise<string> => {
        return pageData.getTextContent().then((textContent: any) => {
          let lastY: number | null = null;
          let text = '';

          for (const item of textContent.items as any[]) {
            // New line when Y coordinate changes meaningfully
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
              text += '\n';
            }
            text += item.str;
            lastY = item.transform[5];
          }

          pageTexts.push(text);
          return text;
        });
      },
    };

    let parsed: any;
    try {
      parsed = await pdfParse(dataBuffer, options);
    } catch (err: any) {
      this.logger.error(`pdf-parse failed: ${err?.message}`);
      const msg = String(err?.message ?? '').toLowerCase();
      const isInvalid =
        msg.includes('invalid') ||
        msg.includes('bad xref') ||
        msg.includes('failed to parse') ||
        msg.includes('password') ||
        msg.includes('unexpectedeof');
      return {
        success: false,
        pages: [],
        pageCount: 0,
        error: `PDF parsing error: ${err?.message}`,
        errorCode: isInvalid ? 'INVALID_PDF' : 'PDF_EXTRACTION_FAILED',
      };
    }

    const totalPages: number = parsed.numpages ?? pageTexts.length;
    this.logger.log(
      `Parsed PDF — ${totalPages} page(s), ${parsed.text?.length ?? 0} total chars`,
    );

    // 4. Detect image-only / unextractable PDF
    const totalChars = pageTexts.reduce((sum, t) => sum + t.trim().length, 0);
    if (totalChars < this.MIN_TEXT_THRESHOLD) {
      this.logger.warn(`PDF appears to contain no extractable text (${totalChars} chars)`);
      return {
        success: false,
        pages: [],
        pageCount: totalPages,
        error: 'PDF contains no extractable text. OCR may be required.',
        errorCode: 'PDF_HAS_NO_EXTRACTABLE_TEXT',
      };
    }

    // 5. Build per-page result
    const pages: ExtractedPage[] = pageTexts.map((rawText, idx) => ({
      pageNumber: idx + 1,
      rawText,
      normalizedText: this.normalizeText(rawText),
    }));

    return {
      success: true,
      pages,
      pageCount: totalPages,
    };
  }

  /**
   * Conservative text normalization.
   * UTF-8 safe — passes French/Arabic/English text through unchanged.
   * Never modifies dates, numbers, names, prices, or administrative data.
   */
  private normalizeText(text: string): string {
    let result = text;

    // Normalize Windows/Mac line endings to Unix
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Collapse 4+ consecutive blank lines to 2 (preserve section breaks)
    result = result.replace(/\n{4,}/g, '\n\n\n');

    // Normalize multiple spaces within each line (never across lines)
    result = result
      .split('\n')
      .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
      .join('\n');

    // Strip leading/trailing whitespace from document
    result = result.trim();

    return result;
  }
}
