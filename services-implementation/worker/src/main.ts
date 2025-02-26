import { NestFactory } from '@nestjs/core';
import { setDefaultResultOrder } from 'dns';
import { WorkerModule } from './worker.module';

setDefaultResultOrder('ipv4first');
process.env.PORT = '3001';

async function bootstrap() {
  const worker = await NestFactory.create(WorkerModule);
  await worker.listen(process.env.PORT ?? 3001);
}
void bootstrap();
