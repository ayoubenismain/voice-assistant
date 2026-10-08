import { Injectable, Logger } from '@nestjs/common';
import { ConversationContextMessage } from './conversation.types.js';

export interface FollowupResolutionResult {
  rawQuery: string;
  effectiveQuery: string;
  wasResolvedAsFollowup: boolean;
  anchorQuery?: string;
}

@Injectable()
export class ConversationFollowupResolverService {
  private readonly logger = new Logger(ConversationFollowupResolverService.name);

  public resolveFollowup(
    currentMessage: string,
    recentMessages: ConversationContextMessage[],
  ): FollowupResolutionResult {
    // 1. Identify if it's a likely follow-up
    const isFollowup = this.isLikelyFollowup(currentMessage);
    
    if (!isFollowup) {
      this.logger.debug(`[FollowupResolver] Not a likely follow-up: "${currentMessage}"`);
      return {
        rawQuery: currentMessage,
        effectiveQuery: currentMessage,
        wasResolvedAsFollowup: false,
      };
    }

    // 2. Find anchor (most recent USER message with effectiveQuery or just content)
    let anchorQuery: string | undefined = undefined;
    
    // recentMessages is chronological (oldest to newest), so we iterate backwards
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      if (msg.role === 'USER') {
        // Exclude if it was out of scope
        if (msg.responseType === 'out_of_scope') continue;
        
        const metadata = msg.metadata as any;
        if (metadata && metadata.effectiveQuery) {
          anchorQuery = metadata.effectiveQuery;
          break;
        } else {
          // Legacy fallback
          anchorQuery = msg.content;
          break;
        }
      }
    }

    if (!anchorQuery) {
      this.logger.debug(`[FollowupResolver] No valid anchor found for follow-up: "${currentMessage}"`);
      return {
        rawQuery: currentMessage,
        effectiveQuery: currentMessage,
        wasResolvedAsFollowup: false,
      };
    }

    // 3. Carry over entities / Topic switching
    const effectiveQuery = this.buildEffectiveQuery(anchorQuery, currentMessage);

    this.logger.log(`[FollowupResolver] Resolved follow-up: anchor="${anchorQuery}" -> effective="${effectiveQuery}"`);

    return {
      rawQuery: currentMessage,
      effectiveQuery,
      wasResolvedAsFollowup: true,
      anchorQuery,
    };
  }

  private isLikelyFollowup(message: string): boolean {
    const norm = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // Explicit entity switch alone is a follow-up if short (e.g. "and for Master?")
    
    const patterns = [
      /\b(tranche(s)?|versement(s)?|payment(s)?|loula|loul(e|a)ni|thenya)\b/i,
      /^(w\s|and\s|et\s)/i,
      /\b(for|pour|lel)\s+(master|licence|license|prepa|preparatoire|cycle|ingenieur)\b/i,
      /\b(9adeh|qadech|how much|combien)\b/i,
      /\b(wa9tech|when|quand)\b/i,
      /\b(win|where|ou|où)\b/i,
      /\b(same for)\b/i,
      /\b(master|licence|license|prepa|preparatoire|cycle|ingenieur)\b/i, // short entity mention
    ];

    const wordCount = norm.split(/\s+/).length;
    
    if (wordCount <= 8) {
      return patterns.some(p => p.test(norm));
    }
    
    if (/^(and|w|et)\s/.test(norm)) return true;

    return false;
  }

  private buildEffectiveQuery(anchor: string, current: string): string {
    let extractedCycle = this.extractCycle(current);
    
    let baseAnchor = anchor;
    // Current overrides old entity
    if (extractedCycle) {
      baseAnchor = this.removeCycle(baseAnchor);
    }
    
    // Simple concatenation. Scope Guard handles the combined text well.
    return `${baseAnchor.trim()}. Follow-up: ${current.trim()}`.replace(/\s+/g, ' ').trim();
  }

  private extractCycle(text: string): string | null {
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (norm.includes('master')) return 'master';
    if (norm.includes('licence') || norm.includes('license')) return 'licence';
    if (norm.includes('prepa') || norm.includes('preparatoire')) return 'prepa';
    if (norm.includes('ingenieur')) return 'ingenieur';
    return null;
  }

  private removeCycle(text: string): string {
    const norm = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return norm.replace(/\b(master|licence|license|prepa|preparatoire|cycle|ingenieur)\b/gi, '').trim();
  }
}
