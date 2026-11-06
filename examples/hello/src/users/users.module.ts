import { defineModule, singleton } from '@suku/core';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

export const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  services: [singleton(UsersService)],
  exports: [UsersService],
});
