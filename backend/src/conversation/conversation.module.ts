import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationContextService } from './conversation-context.service.js';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [ConversationService, ConversationContextService],
  exports: [ConversationService, ConversationContextService],
})
export class ConversationModule {}
