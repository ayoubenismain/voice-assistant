import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import type { PendingClarification, ConversationContextMessage } from './conversation.types.js';

/**
 * Phase 8G — ConversationService
 *
 * Responsibilities:
 *   - getOrCreateConversation(userId): enforces 1 conversation per user
 *   - loadRecentMessages(conversationId, limit): bounded message loading
 *   - saveExchange(conversationId, userContent, assistantContent, responseType): atomic persist
 *   - getPendingClarification(conversationId): read pending state
 *   - setPendingClarification(conversationId, state): save pending state
 *   - clearPendingClarification(conversationId): clear pending state
 *   - resetConversation(userId): clear all messages + pending state
 *
 * SECURITY:
 *   - Each method operates on a specific conversationId obtained via
 *     getOrCreateConversation(userId), guaranteeing user isolation.
 *   - Never log full content, API keys, or conversation history.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the existing conversation for this userId, or creates a new one.
   * Guarantees 1 conversation per userId via the DB @unique constraint.
   */
  async getOrCreateConversation(userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.conversation.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (existing) {
      return existing;
    }

    const created = await this.prisma.conversation.create({
      data: { userId },
      select: { id: true },
    });

    this.logger.log(`[ConversationService] created conversation for userId hash (first 8 chars): ${userId.substring(0, 8)}…`);
    return created;
  }

  /**
   * Loads the N most recent messages for context assembly.
   * Always bounded — never returns the full history.
   */
  async loadRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationContextMessage[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
        responseType: true,
        createdAt: true,
      },
    });

    // Reverse so messages are in chronological order for the context builder
    return rows.reverse().map(r => ({
      role: r.role as 'USER' | 'ASSISTANT' | 'SYSTEM',
      content: r.content,
      responseType: r.responseType,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Atomically persists a completed user+assistant exchange.
   * Do NOT call this if generation failed — corrupted state must be avoided.
   */
  async saveExchange(
    conversationId: string,
    userContent: string,
    assistantContent: string,
    responseType: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: {
          conversationId,
          role: 'USER',
          content: userContent,
        },
      }),
      this.prisma.conversationMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: assistantContent,
          responseType,
        },
      }),
    ]);

    this.logger.debug(
      `[ConversationService] saved exchange conversationId=${conversationId} responseType=${responseType}`,
    );
  }

  /**
   * Returns the active pending clarification, or null.
   */
  async getPendingClarification(
    conversationId: string,
  ): Promise<PendingClarification | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { pendingClarification: true },
    });

    if (!conv || !conv.pendingClarification) return null;

    return (conv.pendingClarification as unknown) as PendingClarification;
  }

  /**
   * Persists a new pending clarification state.
   */
  async setPendingClarification(
    conversationId: string,
    state: PendingClarification,
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { pendingClarification: state as object },
    });

    this.logger.debug(
      `[ConversationService] set pendingClarification for conversationId=${conversationId}`,
    );
  }

  /**
   * Clears the pending clarification state (sets to null).
   */
  async clearPendingClarification(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { pendingClarification: Prisma.JsonNull },
    });

    this.logger.debug(
      `[ConversationService] cleared pendingClarification for conversationId=${conversationId}`,
    );
  }

  /**
   * Resets the conversation: deletes all messages and clears pending state.
   * Future: will power a "Clear conversation" frontend button.
   */
  async resetConversation(userId: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!conv) {
      this.logger.debug(`[ConversationService] resetConversation: no conversation for userId hash ${userId.substring(0, 8)}…`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.conversationMessage.deleteMany({
        where: { conversationId: conv.id },
      }),
      this.prisma.conversation.update({
        where: { id: conv.id },
        data: { pendingClarification: Prisma.JsonNull },
      }),
    ]);

    this.logger.log(`[ConversationService] reset conversation for conversationId=${conv.id}`);
  }
}
