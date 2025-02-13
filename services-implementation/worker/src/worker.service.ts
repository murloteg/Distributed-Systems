import { Injectable } from '@nestjs/common';
import { CrackHashManagerRequest } from './dto/CrackHashManagerRequest';

@Injectable()
export class WorkerService {
  crackHash(crackHashRequest: CrackHashManagerRequest) {
    // TODO: get range for brute force by partNumber
    // For every worker: ((alphabet.length)^maxLength) / (partCount) words
    // const symbols = (alphabet.length) // (partCount) – alphabet indexes AND consider rest
    // [partNumber * symbols; (partNumber + 1) * symbols - 1]
    console.log(
      `Working with ${crackHashRequest.requestId} ID from ${crackHashRequest.partNumber} worker`,
    );
  }
}
