import { Module } from '@nestjs/common';
import { ExternalManagerModule } from 'src/external/external.manager.module';
import { InternalManagerController } from './manager.controller';

@Module({
  imports: [ExternalManagerModule],
  controllers: [InternalManagerController],
})
export class InternalManagerModule {}
