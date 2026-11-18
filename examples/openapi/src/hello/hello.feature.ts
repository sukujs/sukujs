import { feature } from '@sukujs/core';
import { HelloRoutes } from './hello.routes';
import { HelloService } from './hello.service';

export const HelloFeature = feature('hello', {
  routes: [HelloRoutes],
  services: [HelloService],
});
