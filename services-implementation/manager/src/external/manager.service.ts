import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { CrackHashManagerRequest } from './dto/api/CrackHashManagerRequest';
import { CrackHashManagerResponse } from './dto/api/CrackHashManagerResponse';
import { CrackWorkerResponse } from './dto/api/CrackWorkerResponse';
import { PostCrackDto } from './dto/api/PostCrackDto';
import { ResponseCrackDto } from './dto/api/ResponseCrackDto';
import { CrackProcessingRequest } from './dto/CrackProcessingRequest';

@Injectable()
export class ExternalManagerService {
  private readonly alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  private readonly clientRequests: CrackProcessingRequest[] = [];
  private readonly workersCount: number = Number.parseInt(
    process.env['WORKERS_COUNT'] ?? '1',
    10,
  );
  private readonly PROCESSING_TIMEOUT_IN_MSEC = 120000;

  private async sendRequestToWorker(
    requestToWorker: CrackHashManagerRequest,
    workerId: number,
  ) {
    try {
      await axios.post(
        `http://worker-container-${workerId}:3001/internal/api/v1/worker/hash/crack/task`,
        requestToWorker,
      );
      console.log(
        `Successfully sent data (requestId = ${requestToWorker.requestId})` +
          ` to worker with ID: ${requestToWorker.partNumber}`,
      );
    } catch (error) {
      console.error(error);
    }
  }

  handleRequestToCrackHash(postCrackDto: PostCrackDto): ResponseCrackDto {
    console.log(`Manager got request to crack hash from client`);
    const requestId = uuidv4();
    let totalWords = 0;
    for (let power = 1; power <= postCrackDto.maxLength; ++power) {
      totalWords += this.alphabet.length ** power;
    }
    this.clientRequests.push({
      requestId: requestId,
      postCrackDto: postCrackDto,
      status: 'IN_PROGRESS',
      crackResultDto: [],
    });
    const currentRequest = this.clientRequests.find(
      (request) => request.requestId === requestId,
    );
    for (let partNumber = 0; partNumber < this.workersCount; ++partNumber) {
      currentRequest?.crackResultDto.push({
        data: null,
        partNumber: partNumber,
      });

      const requestToWorker: CrackHashManagerRequest = {
        requestId: requestId,
        partCount: totalWords,
        partNumber: partNumber,
        hash: postCrackDto.hash,
        maxLength: postCrackDto.maxLength,
        alphabet: this.alphabet,
        workersCount: this.workersCount,
      };
      void this.sendRequestToWorker(requestToWorker, partNumber);
      const timerId = setTimeout(() => {
        const workerResult = currentRequest?.crackResultDto.find(
          (value) => value.partNumber === partNumber,
        );
        if (!workerResult?.data) {
          console.error(
            `Worker with ID: ${partNumber} failed task` +
              ` (requestId = ${requestId})`,
          );
          currentRequest!.status = 'ERROR';
        }
      }, this.PROCESSING_TIMEOUT_IN_MSEC);
    }

    return {
      requestId: requestId,
    };
  }

  getCrackRequestStatus(requestId: string): CrackHashManagerResponse {
    const crackResultEntity = this.clientRequests.find(
      (value) => value.requestId === requestId,
    );
    if (!crackResultEntity) {
      throw new HttpException('Incorrect requestId', HttpStatus.NOT_FOUND);
    }
    const crackResults: string[] = [];
    let allWorkersFinished = true;
    crackResultEntity.crackResultDto.forEach((value) => {
      if (value.data) {
        crackResults.push(...value.data);
      } else {
        allWorkersFinished = false;
      }
    });

    return {
      status: allWorkersFinished ? 'READY' : crackResultEntity.status,
      data: crackResultEntity.status === 'ERROR' ? null : crackResults,
    };
  }

  getFirstCrackRequestStatus(): CrackHashManagerResponse {
    if (this.clientRequests.length === 0) {
      throw new HttpException('No client requests found', HttpStatus.NOT_FOUND);
    }
    const crackResultEntity = this.clientRequests[0];
    const crackResults: string[] = [];
    let allWorkersFinished = true;
    crackResultEntity.crackResultDto.forEach((value) => {
      if (value.data) {
        crackResults.push(...value.data);
      } else {
        allWorkersFinished = false;
      }
    });

    return {
      status: allWorkersFinished ? 'READY' : crackResultEntity.status,
      data: crackResultEntity.status === 'ERROR' ? null : crackResults,
    };
  }

  updateInfoAboutCrackRequest(crackWorkerResponse: CrackWorkerResponse): void {
    const clientRequest = this.clientRequests.find(
      (value) => value.requestId === crackWorkerResponse.requestId,
    );

    const workerResult = clientRequest?.crackResultDto.find(
      (value) => value.partNumber === crackWorkerResponse.partNumber,
    );
    if (workerResult) {
      workerResult.data = crackWorkerResponse.answers;
    }
    console.log(
      `Got answers (requestId = ${crackWorkerResponse.requestId})` +
        ` from worker with ID: ${crackWorkerResponse.partNumber}\n` +
        `Answers: [${crackWorkerResponse.answers.toString()}]\n`,
    );
  }

  clearTaskQueue(): void {
    this.clientRequests.splice(0, this.clientRequests.length);
  }
}
