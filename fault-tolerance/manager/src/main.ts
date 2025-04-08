import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { setDefaultResultOrder } from 'dns';
import { ManagerModule } from './app.module';

setDefaultResultOrder('ipv4first');
process.env['WORKERS_COUNT'] = process.env['WORKERS_COUNT'] ?? '3';
process.env.PORT = process.env.PORT ?? '3000';

async function bootstrap() {
  try {
    const app = await NestFactory.create(ManagerModule);

    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.RMQ,
        options: {
          urls: ['amqp://user:password@rabbitmq:5672?heartbeat=200'],
          queue: 'worker_response_queue',
          exchange: 'manager_exchange',
          routingKey: 'worker_response_queue',
          noAck: false,
          queueOptions: {
            durable: true,
          },
          prefetchCount: 1,
          persistent: true,
        },
      },
      { inheritAppConfig: true },
    );

    await app.startAllMicroservices();
    await app.listen(process.env.PORT ?? 3000);

    console.log('Manager is listening for responses on worker_response_queue');
  } catch (error) {
    console.error('Error during manager bootstrap:', error);
  }
}
void bootstrap();
