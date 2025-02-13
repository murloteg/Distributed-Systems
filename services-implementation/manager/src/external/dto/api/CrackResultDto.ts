import { CrackResponseStatus } from 'src/external/types/CrackResponseStatus';

export class CrackResultDto {
  status: CrackResponseStatus;
  data: null | string[];
}
