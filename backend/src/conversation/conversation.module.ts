import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationContextService } from './conversation-context.service.js';
import { ConversationFollowupResolverService } from './conversation-followup-resolver.service.js';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [ConversationService, ConversationFollowupResolverService, ConversationContextService],
  exports: [ConversationService, ConversationContextService],
})
export class ConversationModule {}
