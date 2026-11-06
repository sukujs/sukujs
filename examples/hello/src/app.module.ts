import { defineModule } from '@suku/core';
import { AppController, WhoamiController } from './app.controller.js';
import { Env } from './config.js';
import { UsersModule } from './users/users.module.js';

export const AppModule = defineModule({
  name: 'app',
  imports: [Env.load(), UsersModule],
  controllers: [AppController, WhoamiController],
});
