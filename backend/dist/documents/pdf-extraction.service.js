var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PdfExtractionService_1;
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const requireCjs = createRequire(import.meta.url);
const pdfParse = requireCjs('pdf-parse');
let PdfExtractionService = PdfExtractionService_1 = class PdfExtractionService {
    logger = new Logger(PdfExtractionService_1.name);
    MIN_TEXT_THRESHOLD = 20;
    async extractPages(storagePath) {
        const resolvedPath = path.resolve(storagePath);
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
        let dataBuffer;
        try {
            dataBuffer = await fs.promises.readFile(resolvedPath);
        }
        catch (err) {
            this.logger.error(`Failed to read PDF file: ${err}`);
            return {
                success: false,
                pages: [],
                pageCount: 0,
                error: 'Could not read PDF file from disk',
                errorCode: 'PDF_FILE_NOT_FOUND',
            };
        }
        const pageTexts = [];
        const options = {
            pagerender: (pageData) => {
                return pageData.getTextContent().then((textContent) => {
                    let lastY = null;
                    let text = '';
                    for (const item of textContent.items) {
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
        let parsed;
        try {
            parsed = await pdfParse(dataBuffer, options);
        }
        catch (err) {
            this.logger.error(`pdf-parse failed: ${err?.message}`);
            const msg = String(err?.message ?? '').toLowerCase();
            const isInvalid = msg.includes('invalid') ||
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
        const totalPages = parsed.numpages ?? pageTexts.length;
        this.logger.log(`Parsed PDF — ${totalPages} page(s), ${parsed.text?.length ?? 0} total chars`);
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
        const pages = pageTexts.map((rawText, idx) => ({
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
    normalizeText(text) {
        let result = text;
        result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        result = result.replace(/\n{4,}/g, '\n\n\n');
        result = result
            .split('\n')
            .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
            .join('\n');
        result = result.trim();
        return result;
    }
};
PdfExtractionService = PdfExtractionService_1 = __decorate([
    Injectable()
], PdfExtractionService);
export { PdfExtractionService };
//# sourceMappingURL=pdf-extraction.service.js.map