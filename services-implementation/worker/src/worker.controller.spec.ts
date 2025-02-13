import { Test, TestingModule } from '@nestjs/testing';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

describe('WorkerController', () => {
  let workerController: WorkerController;

  beforeEach(async () => {
    const worker: TestingModule = await Test.createTestingModule({
      controllers: [WorkerController],
      providers: [WorkerService],
    }).compile();

    workerController = worker.get<WorkerController>(WorkerController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(workerController.getHello()).toBe('Hello World!');
    });
  });
});
