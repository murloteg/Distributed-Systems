import { NestFactory } from '@nestjs/core';
import { setDefaultResultOrder } from 'dns';
import { ManagerModule } from './app.module';

setDefaultResultOrder('ipv4first');
process.env['WORKERS_COUNT'] = '1';
process.env.PORT = '3000';

async function bootstrap() {
  const app = await NestFactory.create(ManagerModule);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
