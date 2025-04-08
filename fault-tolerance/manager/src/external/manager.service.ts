import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { CrackRequest } from '../schemas/crack-request.schema';
import { CrackHashManagerRequest } from './dto/api/CrackHashManagerRequest';
import { CrackHashManagerResponse } from './dto/api/CrackHashManagerResponse';
import { CrackWorkerResponse } from './dto/api/CrackWorkerResponse';
import { PostCrackDto } from './dto/api/PostCrackDto';
import { ResponseCrackDto } from './dto/api/ResponseCrackDto';
import { CrackResponseStatus } from './types/CrackResponseStatus';

@Injectable()
export class ExternalManagerService {
  private readonly logger = new Logger(ExternalManagerService.name);
  private readonly alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  private readonly workersCount: number = parseInt(
    process.env['WORKERS_COUNT'] ?? '3',
    10,
  );

  constructor(
    @InjectModel(CrackRequest.name)
    private readonly crackRequestModel: Model<CrackRequest>,
    @Inject('TASK_SERVICE') private readonly taskClient: ClientProxy,
  ) {
    this.taskClient
      .connect()
      .catch((err) =>
        this.logger.error('Failed to connect to TASK_SERVICE (queue)', err),
      );
  }

  async handleRequestToCrackHash(
    postCrackDto: PostCrackDto,
  ): Promise<ResponseCrackDto> {
    this.logger.log(
      `Manager got request to crack hash from user: ${postCrackDto.hash}`,
    );
    const requestId = uuidv4();

    const newRequest = new this.crackRequestModel({
      requestId: requestId,
      hash: postCrackDto.hash,
      maxLength: postCrackDto.maxLength,
      status: 'PENDING',
      workersCount: this.workersCount,
      partsDone: 0,
      results: [],
    });

    try {
      await newRequest.save();
      this.logger.log(`Request ${requestId} saved to DB with status PENDING`);
    } catch (error) {
      this.logger.error(`Failed to save request ${requestId} to DB:`, error);
      throw new InternalServerErrorException(
        'Failed to accept crack request (DB error)',
      );
    }

    const response: ResponseCrackDto = { requestId: requestId };
    setTimeout(() => {
      this.trySendTasksToQueue(newRequest);
    }, 0);

    return response;
  }

  private async trySendTasksToQueue(crackRequestDoc: CrackRequest) {
    const { requestId, hash, maxLength, workersCount } = crackRequestDoc;
    this.logger.log(
      `Manager trying to send tasks for request ${requestId} to queue`,
    );

    if (crackRequestDoc.status !== 'PENDING') {
      this.logger.warn(
        `Request ${requestId} is not in PENDING status (${crackRequestDoc.status}). Skipping task sending.`,
      );
      return;
    }

    let totalWords = 0;
    try {
      for (let power = 1; power <= maxLength; ++power) {
        totalWords += this.alphabet.length ** power;
      }
      if (!Number.isFinite(totalWords) || totalWords <= 0) {
        throw new Error(`Calculated totalWords is invalid: ${totalWords}`);
      }
    } catch (e) {
      this.logger.error(
        `Failed to calculate totalWords or invalid result for ${requestId}:`,
        e,
      );
      crackRequestDoc.status = 'ERROR';
      await crackRequestDoc
        .save()
        .catch((err) =>
          this.logger.error(
            `Failed to save ERROR status for ${requestId}`,
            err,
          ),
        );
      return;
    }

    let tasksSentSuccessfully = 0;
    for (let partNumber = 0; partNumber < workersCount; ++partNumber) {
      const requestToWorker: CrackHashManagerRequest = {
        requestId: requestId,
        partCount: totalWords,
        partNumber: partNumber,
        hash: hash,
        maxLength: maxLength,
        alphabet: this.alphabet,
        workersCount: workersCount,
      };

      try {
        await this.taskClient.send('task_queue', requestToWorker).toPromise();
        this.logger.log(
          `Task ${requestId} with partNumber ${partNumber} successfully sent/queued by client.`,
        );
        tasksSentSuccessfully++;
      } catch (error) {
        this.logger.error(
          `Failed to send task ${requestId} with partNumber ${partNumber} to queue: `,
          error.message || error,
        );
        break;
      }
    }

    if (
      tasksSentSuccessfully === workersCount &&
      crackRequestDoc.status === 'PENDING'
    ) {
      crackRequestDoc.status = 'IN_PROGRESS';
      try {
        await this.crackRequestModel
          .updateOne(
            { requestId: crackRequestDoc.requestId, status: 'PENDING' },
            { $set: { status: 'IN_PROGRESS' } },
          )
          .exec();
        this.logger.log(`Request ${requestId} status updated to IN_PROGRESS`);
      } catch (dbError) {
        this.logger.error(
          `Failed to update status to IN_PROGRESS for task ${requestId}: `,
          dbError,
        );
      }
    } else if (tasksSentSuccessfully < workersCount) {
      this.logger.warn(
        `For request ${requestId}: only ${tasksSentSuccessfully}/${workersCount} tasks could be sent/queued. Status remains PENDING for retry.`,
      );
    }
  }

  async updateInfoAboutCrackRequest(
    crackWorkerResponse: CrackWorkerResponse,
  ): Promise<void> {
    const { requestId, partNumber, answers } = crackWorkerResponse;
    this.logger.log(
      `
        Processing result for ${requestId} with partNumber ${partNumber}. 
        Answers: [${answers.toString()}]`,
    );

    try {
      const crackRequest = await this.crackRequestModel
        .findOne({ requestId: requestId })
        .exec();

      if (!crackRequest) {
        this.logger.error(
          `Received result for unknown request ID: ${requestId}`,
        );
        return;
      }

      let requireSave = false;
      if (answers && answers.length > 0) {
        for (const answer of answers) {
          if (!crackRequest.results.includes(answer)) {
            crackRequest.results.push(answer);
            requireSave = true;
          }
        }
      }

      if (crackRequest.status === 'IN_PROGRESS') {
        crackRequest.partsDone += 1;
        requireSave = true;

        this.logger.log(
          `Request ${requestId}: got new worker response (${crackRequest.partsDone}/${crackRequest.workersCount})`,
        );

        if (crackRequest.partsDone === crackRequest.workersCount) {
          crackRequest.status = 'READY';
          this.logger.log(`Request ${requestId} status updated to READY`);
        }
      }

      if (requireSave) {
        await crackRequest.save();
        this.logger.log(`Request ${requestId} updated in DB`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update DB for request ${requestId} with partNumber ${partNumber}:`,
        error,
      );
      throw error;
    }
  }

  async getCrackRequestStatus(
    requestId: string,
  ): Promise<CrackHashManagerResponse> {
    const crackRequest = await this.crackRequestModel
      .findOne({ requestId: requestId })
      .exec();

    if (!crackRequest) {
      throw new NotFoundException(`Request with ID ${requestId} not found`);
    }

    const apiStatus: CrackResponseStatus = crackRequest.status;
    return {
      status: apiStatus,
      data: apiStatus === 'READY' ? crackRequest.results : null,
    };
  }

  async getFirstCrackRequestStatus(): Promise<CrackHashManagerResponse> {
    const crackRequest = await this.crackRequestModel
      .findOne()
      .sort({ createdAt: 1 })
      .exec();
    if (!crackRequest) {
      throw new NotFoundException('No crack requests found');
    }
    return this.getCrackRequestStatus(crackRequest.requestId);
  }

  async clearTaskQueue(): Promise<void> {
    try {
      const deleteResult = await this.crackRequestModel.deleteMany({}).exec();
      this.logger.log(
        `Cleared crack_requests collection. Deleted: ${deleteResult.deletedCount}`,
      );
    } catch (error) {
      this.logger.error('Failed to clear crack_requests collection:', error);
      throw new InternalServerErrorException('Failed to clear requests.');
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async retryPendingTasks() {
    try {
      this.logger.log(
        '[Scheduler] Checking for PENDING tasks to retry sending...',
      );
      const pendingRequests = await this.crackRequestModel
        .find({
          status: 'PENDING',
        })
        .limit(10)
        .exec();

      if (pendingRequests.length === 0) {
        this.logger.log('[Scheduler] No PENDING tasks found.');
        return;
      }

      this.logger.log(
        `[Scheduler] Found ${pendingRequests.length} PENDING tasks. Retrying send...`,
      );
      for (const requestDoc of pendingRequests) {
        this.logger.log(
          `[Scheduler] Retrying task send for ${requestDoc.requestId}`,
        );
        await this.trySendTasksToQueue(requestDoc);
        const timeDelayInMsec = 200;
        await new Promise((resolve) => setTimeout(resolve, timeDelayInMsec));
      }
      this.logger.log('[Scheduler] Finished PENDING task retry cycle.');
    } catch (error) {
      this.logger.error('[Scheduler] Error during PENDING task retry:', error);
    }
  }
}
