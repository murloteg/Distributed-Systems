import { Module } from '@nestjs/common';
import { ExternalManagerController } from './manager.controller';
import { ExternalManagerService } from './manager.service';

@Module({
  exports: [ExternalManagerService],
  controllers: [ExternalManagerController],
  providers: [ExternalManagerService],
})
export class ExternalManagerModule {}
