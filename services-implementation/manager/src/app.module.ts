import { Module } from '@nestjs/common';
import { ExternalManagerModule } from './external/external.manager.module';
import { InternalManagerModule } from './internal/internal.manager.module';

@Module({
  imports: [ExternalManagerModule, InternalManagerModule],
})
export class ManagerModule {}
