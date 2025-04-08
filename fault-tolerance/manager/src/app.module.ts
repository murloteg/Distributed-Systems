import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MongooseModule } from '@nestjs/mongoose';
import { ExternalManagerController } from './external/manager.controller';
import { ExternalManagerService } from './external/manager.service';

import { ScheduleModule } from '@nestjs/schedule';
import {
  CrackRequest,
  CrackRequestSchema,
} from './schemas/crack-request.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
          throw new Error('MONGODB_URI environment variable is not set');
        }
        console.log(
          `Connecting to MongoDB: ${uri.replace(/:([^:]+)@/, ':*****@')}`,
        );
        return {
          uri: uri,
          writeConcern: { w: 'majority' },
        };
      },
    }),
    MongooseModule.forFeature([
      { name: CrackRequest.name, schema: CrackRequestSchema },
    ]),
    ClientsModule.register([
      {
        name: 'TASK_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URI ||
              'amqp://user:password@rabbitmq:5672?heartbeat=200',
          ],
          queue: 'task_queue',
          exchange: 'manager_exchange',
          routingKey: 'task_queue',
          queueOptions: { durable: true },
          persistent: true,
        },
      },
    ]),
    ScheduleModule.forRoot(),
  ],
  controllers: [ExternalManagerController],
  providers: [ExternalManagerService],
  exports: [ExternalManagerService],
})
export class ManagerModule {}
