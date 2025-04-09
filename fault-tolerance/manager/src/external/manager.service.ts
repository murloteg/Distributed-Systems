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
      this.logger.log(
        `Request ${requestId} saved to MongoDB with status PENDING`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save request ${requestId} to MongoDB: ${error}`,
      );
      throw new InternalServerErrorException(
        'Failed to accept crack request (MongoDB error)',
      );
    }

    const response: ResponseCrackDto = { requestId: requestId };
    return response;
  }

  private async trySendTasksToQueue(
    crackRequestDoc: CrackRequest,
  ): Promise<boolean> {
    const { requestId, hash, maxLength, workersCount } = crackRequestDoc;

    let totalWords = 0;
    try {
      for (let power = 1; power <= maxLength; ++power) {
        totalWords += this.alphabet.length ** power;
      }
      if (!Number.isFinite(totalWords) || totalWords <= 0) {
        throw new Error(`Error during calculate totalWorlds: ${totalWords}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to calculate totalWords for ${requestId}: ${error}`,
      );
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
      const taskDescription = `Task ${requestId} with partNumber: ${partNumber}`;

      try {
        this.logger.log(`Manager attempting to send: ${taskDescription}`);
        await this.taskClient.emit('task_queue', requestToWorker).toPromise();
        this.logger.log(`Manager successfully sending: ${taskDescription}`);
        tasksSentSuccessfully++;
      } catch (error) {
        this.logger.error(
          `Manager failure to send ${taskDescription}: `,
          error.message || error,
        );
        return false;
      }
    }

    if (tasksSentSuccessfully === workersCount) {
      this.logger.log(
        `Manager sent all (${workersCount}) tasks for ${requestId} successfully!`,
      );
      return true;
    } else {
      this.logger.error(
        `Manager got error for ${requestId} when sending tasks`,
      );
      return false;
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async retryPendingTasks() {
    this.logger.log('[Scheduler] Checking tasks in PENDING status...');
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
            this.logger.log('[Scheduler] No tasks in PENDING status found');
          }
          break;
        }

        this.logger.log(
          `[Scheduler] Status of task ${requestToProcess.requestId} updated to SENDING`,
        );
        processedCount++;

        const sendSuccess = await this.trySendTasksToQueue(requestToProcess);

        const finalStatus = sendSuccess ? 'IN_PROGRESS' : 'PENDING';
        const updateResult = await this.crackRequestModel
          .updateOne(
            { requestId: requestToProcess.requestId, status: 'SENDING' },
            { $set: { status: finalStatus } },
          )
          .exec();

        if (updateResult.modifiedCount > 0) {
          this.logger.log(
            `[Scheduler] Status of task ${requestToProcess.requestId} updated to ${finalStatus}`,
          );
        } else {
          this.logger.warn(
            `[Scheduler] Status of task ${requestToProcess.requestId} NOT updated! It still SENDING`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        this.logger.error(
          `[Scheduler] Error during task processing cycle: ${error}`,
        );
        if (requestToProcess) {
          this.logger.warn(
            `[Scheduler] Manager trying revert status to PENDING for ${requestToProcess.requestId}`,
          );
          await this.crackRequestModel
            .updateOne(
              { requestId: requestToProcess.requestId, status: 'SENDING' },
              { $set: { status: 'PENDING' } },
            )
            .catch((revertError) =>
              this.logger.error(`
                [Scheduler] Manager failed to revert status to PENDING
                 for ${requestToProcess?.requestId}: ${revertError}
              `),
            );
        }
        break;
      }
    }

    if (processedCount > 0) {
      this.logger.log(
        `[Scheduler] Manager successfully processed ${processedCount} PENDING tasks`,
      );
    }
  }

  async updateInfoAboutCrackRequest(
    crackWorkerResponse: CrackWorkerResponse,
  ): Promise<void> {
    const { requestId, partNumber, answers } = crackWorkerResponse;
    this.logger.log(`
        Processing result for ${requestId} with partNumber ${partNumber}.
        Answers: [${answers?.join(', ')}]
    `);

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
          `Received duplicate result for ${requestId}, part ${partNumber}`,
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

        if (crackRequest.partsDone === crackRequest.workersCount) {
          crackRequest.status = 'READY';
          this.logger.log(
            `Task ${crackRequest.requestId} was completed (status: READY)`,
          );
        }
      }

      if (requireSave) {
        await crackRequest.save();
        this.logger.log(
          `Request ${requestId} updated in DB after processing part ${partNumber}.`,
        );
      }
    } catch (error) {
      this.logger.error(`
        Failed to update DB for request ${requestId}, part ${partNumber}: ${error}
      `);
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

  async getLastCrackRequestStatus(): Promise<CrackHashManagerResponse> {
    const crackRequest = await this.crackRequestModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec();

    if (!crackRequest) {
      throw new NotFoundException('No crack requests found');
    }
    return this.getCrackRequestStatus(crackRequest.requestId);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async syncInProgressTasks() {
    const inProgressTasks = await this.crackRequestModel.find({
      status: 'IN_PROGRESS',
    });

    for (const task of inProgressTasks) {
      const actualPartsDone = task.partsReceived.length;
      if (task.partsDone === actualPartsDone) {
        continue;
      }

      task.partsDone = actualPartsDone;
      task.updatedAt = new Date();

      if (actualPartsDone === task.workersCount) {
        task.status = 'READY';
        this.logger.log(`Task ${task.requestId} was completed (status: READY)`);
      } else {
        this.logger.log(
          `Updated task ${task.requestId}: new partsDone is ${actualPartsDone}`,
        );
      }
      await task.save();
    }
  }
}
