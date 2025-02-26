import { Body, Controller, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { CrackWorkerResponse } from 'src/external/dto/api/CrackWorkerResponse';
import { ExternalManagerService } from 'src/external/manager.service';

@Controller('/internal/api/v1/manager/hash/crack/request')
export class InternalManagerController {
  constructor(private readonly managerService: ExternalManagerService) {}

  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  updateInfoAboutCrackRequest(
    @Body() crackWorkerResponse: CrackWorkerResponse,
  ) {
    this.managerService.updateInfoAboutCrackRequest(crackWorkerResponse);
  }
}
