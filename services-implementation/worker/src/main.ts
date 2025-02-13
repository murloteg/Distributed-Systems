import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const worker = await NestFactory.create(WorkerModule);
  await worker.listen(process.env.PORT ?? 3001);
}
void bootstrap();
