import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { CrackResultDto } from './dto/api/CrackResultDto';
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
  getCrackResult(@Query('requestId') requestId: string): CrackResultDto {
    return this.managerService.getCrackRequestStatus(requestId);
  }
}
