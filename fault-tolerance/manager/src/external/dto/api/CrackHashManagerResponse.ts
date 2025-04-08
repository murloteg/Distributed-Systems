import { CrackResponseStatus } from 'src/external/types/CrackResponseStatus';

export interface CrackHashManagerResponse {
  status: CrackResponseStatus;
  data: string[] | null;
}
