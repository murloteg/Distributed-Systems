import { CrackResultDto } from './api/CrackResultDto';
import { PostCrackDto } from './api/PostCrackDto';

export class CrackProcessingRequest {
  requestId: string;
  partNumber: number;
  postCrackDto: PostCrackDto;
  crackResultDto: CrackResultDto;
}
