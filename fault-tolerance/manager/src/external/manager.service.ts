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
      partsReceived: [],
      results: [],
    });

    try {
      await newRequest.save();
      this.logger.log(`Request ${requestId} saved to DB with status PENDING.`);
    } catch (error) {
      this.logger.error(`Failed to save request ${requestId} to DB:`, error);
      throw new InternalServerErrorException(
        'Failed to accept crack request (DB error)',
      );
    }

    const response: ResponseCrackDto = { requestId: requestId };
    return response;
  }

  private async trySendTasksToQueue(
    crackRequestDoc: CrackRequest,
  ): Promise<boolean> {
    const { requestId, hash, maxLength, workersCount } = crackRequestDoc;
    this.logger.log(
      `Manager attempting to send tasks for request ${requestId} (status: ${crackRequestDoc.status})`,
    );

    let totalWords = 0;
    try {
      for (let power = 1; power <= maxLength; ++power) {
        totalWords += this.alphabet.length ** power;
      }
      if (!Number.isFinite(totalWords) || totalWords <= 0) {
        throw new Error(`Calculated totalWords is invalid: ${totalWords}`);
      }
    } catch (e) {
      this.logger.error(`Failed to calculate totalWords for ${requestId}:`, e);
      await this.crackRequestModel
        .updateOne({ requestId }, { $set: { status: 'ERROR' } })
        .exec();
      return false;
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
          `Task ${requestId} part ${partNumber} successfully sent/queued by client.`,
        );
        tasksSentSuccessfully++;
      } catch (error) {
        this.logger.error(
          `Failed to send task ${requestId} part ${partNumber} to queue: `,
          error.message || error,
        );

        return false;
      }
    }

    if (tasksSentSuccessfully === workersCount) {
      this.logger.log(
        `All ${workersCount} tasks for ${requestId} sent successfully.`,
      );
      return true;
    } else {
      this.logger.warn(
        `Unexpected state: ${tasksSentSuccessfully} (tasksSentSuccessfully) != ${workersCount} (workersCount) for ${requestId}`,
      );
      return false;
    }
  }

  async updateInfoAboutCrackRequest(
    crackWorkerResponse: CrackWorkerResponse,
  ): Promise<void> {
    const { requestId, partNumber, answers } = crackWorkerResponse;
    this.logger.log(`
        Processing result for ${requestId} with partNumber ${partNumber}. Answers: [${answers?.join(', ')}]`);

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

      if (crackRequest.partsReceived.includes(partNumber)) {
        this.logger.warn(
          `Received duplicate result for ${requestId}, part ${partNumber}. Ignoring.`,
        );
        return;
      }

      let requireSave = false;

      crackRequest.partsReceived.push(partNumber);
      requireSave = true;

      if (answers && answers.length > 0) {
        for (const answer of answers) {
          if (!crackRequest.results.includes(answer)) {
            crackRequest.results.push(answer);
          }
        }
      }

      if (['PENDING', 'SENDING', 'IN_PROGRESS'].includes(crackRequest.status)) {
        crackRequest.partsDone += 1;

        this.logger.log(`
          Request ${requestId}: processed part ${partNumber}. Progress (${crackRequest.partsDone}/${crackRequest.workersCount})`);

        if (crackRequest.partsDone === crackRequest.workersCount) {
          crackRequest.status = 'READY';
          this.logger.log(`Request ${requestId} status updated to READY`);
        }
      } else {
        this.logger.warn(`
            Request ${requestId}: Received part ${partNumber} while status is ${crackRequest.status}. Only updating partsReceived/results
        `);
      }

      if (requireSave) {
        await crackRequest.save();
        this.logger.log(
          `Request ${requestId} updated in DB after processing part ${partNumber}.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `
        Failed to update DB for request ${requestId}, part ${partNumber}:`,
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

  @Cron(CronExpression.EVERY_10_SECONDS)
  async retryPendingTasks() {
    this.logger.log('[Scheduler] Checking for tasks to process...');
    let processedCount = 0;
    const maxToProcess = 5;

    while (processedCount < maxToProcess) {
      let requestToProcess: CrackRequest | null = null;
      try {
        requestToProcess = await this.crackRequestModel
          .findOneAndUpdate(
            { status: 'PENDING' },
            { $set: { status: 'SENDING' } },
            { new: true, sort: { createdAt: 1 } },
          )
          .exec();

        if (!requestToProcess) {
          if (processedCount === 0) {
            this.logger.log('[Scheduler] No PENDING tasks found to process.');
          }
          break;
        }

        this.logger.log(
          `[Scheduler] Picked up task ${requestToProcess.requestId} for sending (status changed to SENDING).`,
        );
        processedCount++;

        const sendSuccess = await this.trySendTasksToQueue(requestToProcess);

        let finalStatus: CrackResponseStatus;
        if (sendSuccess) {
          finalStatus = 'IN_PROGRESS';
          this.logger.log(
            `[Scheduler] Successfully sent tasks for ${requestToProcess.requestId}. Updating status to IN_PROGRESS.`,
          );
        } else {
          finalStatus = 'PENDING';
          this.logger.warn(
            `[Scheduler] Failed to send tasks for ${requestToProcess.requestId}. Reverting status to PENDING.`,
          );
        }

        await this.crackRequestModel
          .updateOne(
            { requestId: requestToProcess.requestId, status: 'SENDING' },
            { $set: { status: finalStatus } },
          )
          .exec();

        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        this.logger.error(
          '[Scheduler] Error during task processing cycle:',
          error,
        );
        if (requestToProcess) {
          this.logger.warn(
            `[Scheduler] Attempting to revert status to PENDING for ${requestToProcess.requestId} due to error.`,
          );
          await this.crackRequestModel
            .updateOne(
              { requestId: requestToProcess.requestId, status: 'SENDING' },
              { $set: { status: 'PENDING' } },
            )
            .catch((revertError) =>
              this.logger.error(
                `[Scheduler] CRITICAL: Failed to revert status to PENDING for ${requestToProcess?.requestId}`,
                revertError,
              ),
            );
        }
        break;
      }
    }

    if (processedCount > 0) {
      this.logger.log(
        `[Scheduler] Finished processing cycle. Processed ${processedCount} tasks.`,
      );
    }
  }
}
