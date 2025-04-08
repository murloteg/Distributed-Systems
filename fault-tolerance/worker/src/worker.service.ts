import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { md5 } from 'js-md5';
import { CrackHashManagerRequest } from './dto/CrackHashManagerRequest';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);
  constructor(
    @Inject('RESULT_SERVICE') private readonly resultClient: ClientProxy,
  ) {
    this.resultClient.connect().catch((err) => {
      this.logger.error(
        'Worker failed to connect RESULT_SERVICE (queue) client',
        err,
      );
    });
  }

  private findWordsCountWithPreviousLength(
    index: number,
    alphabetLength: number,
  ) {
    let sum = 0;
    let power = 1;

    while (sum + alphabetLength ** power <= index) {
      sum += alphabetLength ** power;
      ++power;
    }
    return sum;
  }

  private getNewWordIndex(index: number, wordsCountWithPreviousLength: number) {
    return index - wordsCountWithPreviousLength;
  }

  private convertIndexToWord(index: number, alphabet: string): string {
    const alphabetLength = alphabet.length;
    const wordsCountWithPreviousLength = this.findWordsCountWithPreviousLength(
      index,
      alphabetLength,
    );
    const newWordIndex = this.getNewWordIndex(
      index,
      wordsCountWithPreviousLength,
    );

    const convertedIndexes: number[] = [];
    let nextResult = newWordIndex;
    while (nextResult > 0) {
      const remainder = nextResult % alphabetLength;
      convertedIndexes.push(remainder);
      nextResult = Math.floor(nextResult / alphabetLength);
    }
    let decodedWord = '';
    convertedIndexes.reverse().forEach((value: number) => {
      decodedWord += alphabet[value];
    });
    return decodedWord;
  }

  async handleTask(task: CrackHashManagerRequest) {
    this.logger.log(
      `Worker got task ${task.requestId} with partNumber ${task.partNumber}`,
    );
    const result = this.processTask(task);
    const workerResponse = {
      requestId: task.requestId,
      partNumber: task.partNumber,
      answers: result,
    };

    try {
      await this.resultClient
        .emit('worker_response_queue', workerResponse)
        .toPromise();

      this.logger.log(
        `Worker sent response for task ${task.requestId} with partNumber ${task.partNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Worker failed to send response for task ${task.requestId} with
         partNumber ${task.partNumber}: `,
        error,
      );
      throw error;
    }
  }

  processTask(task: CrackHashManagerRequest): string[] {
    const wordsCountPerWorker = Math.floor(task.partCount / task.workersCount);
    const startPosition = task.partNumber * wordsCountPerWorker;

    const endPosition =
      task.partNumber === task.workersCount - 1
        ? task.partCount
        : (task.partNumber + 1) * wordsCountPerWorker;

    const decodedWords = [];
    for (let index = startPosition; index < endPosition; ++index) {
      const decodedWord = this.convertIndexToWord(index, task.alphabet);
      if (md5(decodedWord) === task.hash) {
        decodedWords.push(decodedWord);
      }
    }
    return decodedWords;
  }
}
