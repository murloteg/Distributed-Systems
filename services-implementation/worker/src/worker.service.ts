import { Injectable } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { md5 } from 'js-md5';
import { CrackHashManagerRequest } from './dto/CrackHashManagerRequest';
import { UpdateManagerInfoDto } from './dto/UpdateManagerInfoDto';
@Injectable()
export class WorkerService {
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

  private async updateManagerInfo({
    requestId,
    partNumber,
    answers,
  }: UpdateManagerInfoDto) {
    await axios
      .patch(
        'http://manager-container:3000/internal/api/v1/manager/hash/crack/request',
        {
          requestId: requestId,
          partNumber: partNumber,
          answers: answers,
        },
      )
      .then((response: AxiosResponse) => {
        console.log(
          `Worker with ID: ${partNumber} sent crack result (requestId = ${requestId}) to manager`,
        );
      })
      .catch((error) => {
        console.error(error);
      });
  }

  public crackHash(crackHashRequest: CrackHashManagerRequest) {
    console.log(
      `Worker with ID: ${crackHashRequest.partNumber} got request (requestId = ${crackHashRequest.requestId}) from manager`,
    );
    const workerId = crackHashRequest.partNumber;
    const wordsCountPerWorker = Math.floor(
      crackHashRequest.partCount / crackHashRequest.workersCount,
    );
    let startPosition = 0;
    let endPosition = 0;
    const remainsByDivision =
      crackHashRequest.partCount % crackHashRequest.workersCount;
    if (crackHashRequest.workersCount === 1 || remainsByDivision === 0) {
      startPosition = workerId * wordsCountPerWorker;
      endPosition = (workerId + 1) * wordsCountPerWorker;
    } else {
      // TODO
    }
    const decodedWords = [];
    for (let index = startPosition; index < endPosition; ++index) {
      const decodedWord = this.convertIndexToWord(
        index,
        crackHashRequest.alphabet,
      );
      if (md5(decodedWord) === crackHashRequest.hash) {
        decodedWords.push(decodedWord);
      }
    }
    const UpdateManagerInfoDto: UpdateManagerInfoDto = {
      requestId: crackHashRequest.requestId,
      partNumber: crackHashRequest.partNumber,
      answers: decodedWords,
    };
    void this.updateManagerInfo(UpdateManagerInfoDto);
  }
}
