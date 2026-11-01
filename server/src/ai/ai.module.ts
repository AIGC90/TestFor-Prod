import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService, anthropicProvider } from './ai.service';

@Module({
  controllers: [AiController],
  providers: [anthropicProvider, AiService],
})
export class AiModule {}
