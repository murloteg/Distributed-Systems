import { CrackResponseStatus } from '../types/CrackResponseStatus';
import { CrackResultDto } from './api/CrackResultDto';
import { PostCrackDto } from './api/PostCrackDto';

export class CrackProcessingRequest {
  requestId: string;
  postCrackDto: PostCrackDto;
  status: CrackResponseStatus;
  crackResultDto: CrackResultDto[];
}
