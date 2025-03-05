import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { CrackHashManagerResponse } from './dto/api/CrackHashManagerResponse';
import { PostCrackDto } from './dto/api/PostCrackDto';
import { ResponseCrackDto } from './dto/api/ResponseCrackDto';
import { ExternalManagerService } from './manager.service';

@Controller('/api/v1/hash/')
export class ExternalManagerController {
  constructor(private readonly managerService: ExternalManagerService) {}

  @Post('crack')
  @HttpCode(HttpStatus.CREATED)
  crackHash(@Body() postCrackDto: PostCrackDto): ResponseCrackDto {
    return this.managerService.handleRequestToCrackHash(postCrackDto);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  getCrackResult(
    @Query('requestId') requestId: string,
  ): CrackHashManagerResponse {
    return this.managerService.getCrackRequestStatus(requestId);
  }

  @Get('status/first')
  @HttpCode(HttpStatus.OK)
  getFirstCrackResult(): CrackHashManagerResponse {
    return this.managerService.getFirstCrackRequestStatus();
  }
}
