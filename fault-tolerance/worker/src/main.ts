import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { setDefaultResultOrder } from 'dns';
import { WorkerModule } from './worker.module';

setDefaultResultOrder('ipv4first');
process.env.PORT = '3001';

async function bootstrap() {
  try {
    const app = await NestFactory.create(WorkerModule);

    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://user:password@rabbitmq:5672?heartbeat=200'],
        queue: 'task_queue',
        routingKey: 'task_queue',
        noAck: false,
        queueOptions: {
          durable: true,
        },
        persistent: true,
      },
    });
    await app.startAllMicroservices();

    console.log(
      'Worker microservice started, listening for tasks on task_queue',
    );
  } catch (error) {
    console.error('Error during worker bootstrap:', error);
  }
}
void bootstrap();
