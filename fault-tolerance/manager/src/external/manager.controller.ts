import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { CrackHashManagerResponse } from './dto/api/CrackHashManagerResponse';
import { CrackWorkerResponse } from './dto/api/CrackWorkerResponse';
import { PostCrackDto } from './dto/api/PostCrackDto';
import { ResponseCrackDto } from './dto/api/ResponseCrackDto';
import { ExternalManagerService } from './manager.service';

@Controller('/api/v1/hash/')
export class ExternalManagerController {
  private readonly logger = new Logger(ExternalManagerController.name);
  constructor(private readonly managerService: ExternalManagerService) {}

  @Post('crack')
  @HttpCode(HttpStatus.CREATED)
  async crackHash(
    @Body() postCrackDto: PostCrackDto,
  ): Promise<ResponseCrackDto> {
    return await this.managerService.handleRequestToCrackHash(postCrackDto);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getCrackResult(
    @Query('requestId') requestId: string,
  ): Promise<CrackHashManagerResponse> {
    return await this.managerService.getCrackRequestStatus(requestId);
  }

  @Get('status/last')
  @HttpCode(HttpStatus.OK)
  async getFirstCrackResult(): Promise<CrackHashManagerResponse> {
    return await this.managerService.getLastCrackRequestStatus();
  }

  @EventPattern('worker_response_queue')
  async handleWorkerResponse(
    @Payload() crackWorkerResponse: CrackWorkerResponse,
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(`
        Manager received result of task: ${crackWorkerResponse.requestId} 
        with partNumber: ${crackWorkerResponse.partNumber}`);
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();
    try {
      await this.managerService.updateInfoAboutCrackRequest(
        crackWorkerResponse,
      );
      channel.ack(originalMessage);
    } catch (error) {
      this.logger.error('Error processing worker response event:', error);
      channel.nack(originalMessage, false, false);
    }
  }
}
