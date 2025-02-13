import { Test, TestingModule } from '@nestjs/testing';
import { ExternalManagerController } from './manager.controller';
import { ExternalManagerService } from './manager.service';

describe('ManagerController', () => {
  let managerController: ExternalManagerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExternalManagerController],
      providers: [ExternalManagerService],
    }).compile();

    managerController = app.get<ExternalManagerController>(
      ExternalManagerController,
    );
  });

  // Tests for external manager controller
  // describe('root', () => {
  //   it('should return "Hello World!"', () => {
  //     expect(managerController.getHello()).toBe('Hello World!');
  //   });
  // });
});
