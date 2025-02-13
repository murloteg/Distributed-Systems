import { Body, Controller, Post } from '@nestjs/common';
import { CrackHashManagerRequest } from './dto/CrackHashManagerRequest';
import { WorkerService } from './worker.service';

@Controller('/internal/api/v1/worker/hash/crack/task')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Post()
  executeCrackTask(@Body() crackHashRequest: CrackHashManagerRequest) {
    this.workerService.crackHash(crackHashRequest);
  }
}
