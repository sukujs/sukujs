import { feature, singleton } from '@sukujs/core';
import { UsersRoutes } from './users.routes';
import { UsersService } from './users.service';

export const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});
