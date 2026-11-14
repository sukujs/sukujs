import { feature, singleton } from '@suku/core';
import { UsersRoutes } from './users.routes.js';
import { UsersService } from './users.service.js';

export const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});
