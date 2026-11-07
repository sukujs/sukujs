import { Controller, Get, Module, Param, Suku } from '@suku/core';
import { bunAdapter } from '@suku/platform-bun';
import { nodeAdapter } from '@suku/platform-node';

@Controller('users')
class UsersController {
  @Get(':id')
  get(@Param('id') id: string) {
    return { id };
  }
}

@Controller()
class RootController {
  @Get()
  root() {
    return { hello: 'world' };
  }
}

@Module({ controllers: [UsersController, RootController] })
class AppModule {}

const adapter = typeof Bun !== 'undefined' ? bunAdapter() : nodeAdapter();
const app = await Suku.create(AppModule, { adapter });
const server = await app.listen({ port: 0, hostname: '127.0.0.1' });
console.log(`listening on ${server.url}`);
