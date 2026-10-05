import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScopeGuardService } from './scope-guard.service.js';
import { ScopeClassifierProvider } from './scope-classifier.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [ScopeGuardService, ScopeClassifierProvider],
  exports: [ScopeGuardService],
})
export class ScopeGuardModule {}
