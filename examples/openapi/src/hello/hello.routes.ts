import { Routes, route } from '@sukujs/core';
import { z } from 'zod';
import { HelloService } from './hello.service';

@Routes('/hello')
export class HelloRoutes {
  constructor(private readonly hello: HelloService) {}

  greet = route.get('/:name', {
    params: z.object({ name: z.string().min(1).max(50) }),
    handle: ({ params }) => ({ message: this.hello.greet(params.name) }),
  });
}
