import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { CrackHashManagerRequest } from './dto/CrackHashManagerRequest';
import { WorkerService } from './worker.service';

@Controller()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);
  constructor(private readonly workerService: WorkerService) {}

  @MessagePattern('task_queue')
  async handleTask(
    @Payload() task: CrackHashManagerRequest,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      await this.workerService.handleTask(task);
      channel.ack(originalMessage);
      this.logger.log(
        `Worker ACK for task ${task.requestId} with partNumber ${task.partNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing task or sending response: ${task.requestId} part ${task.partNumber}`,
        error,
      );
      channel.nack(originalMessage, false, true);
    }
  }
}
