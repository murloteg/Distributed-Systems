import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CrackResultDto } from './dto/api/CrackResultDto';
import { CrackWorkerResponse } from './dto/api/CrackWorkerResponse';
import { PostCrackDto } from './dto/api/PostCrackDto';
import { ResponseCrackDto } from './dto/api/ResponseCrackDto';
import { CrackProcessingRequest } from './dto/CrackProcessingRequest';

@Injectable()
export class ExternalManagerService {
  private readonly alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  private readonly clientRequests: CrackProcessingRequest[] = [];
  private readonly partCount: number = Number.parseInt(
    process.env['WORKERS_COUNT'] ?? '1',
    10,
  );

  handleRequestToCrackHash(postCrackDto: PostCrackDto): ResponseCrackDto {
    const requestId = uuidv4();
    for (let partNumber = 0; partNumber < this.partCount; ++partNumber) {
      this.clientRequests.push({
        requestId: requestId,
        postCrackDto: postCrackDto,
        partNumber: partNumber,
        crackResultDto: {
          status: 'IN_PROGRESS',
          data: null,
        },
      });
      // TODO: call worker API here;
    }

    return {
      requestId: requestId,
    };
  }

  getCrackRequestStatus(requestId: string): CrackResultDto {
    const crackResultEntity = this.clientRequests.find(
      (value) => value.requestId === requestId,
    );
    if (!crackResultEntity) {
      throw new HttpException('Incorrect requestId', HttpStatus.NOT_FOUND);
    }
    return crackResultEntity.crackResultDto;
  }

  updateInfoAboutCrackRequest(crackWorkerResponse: CrackWorkerResponse): void {}
}
