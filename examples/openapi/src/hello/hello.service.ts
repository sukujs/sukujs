import { Service } from '@sukujs/core';

@Service()
export class HelloService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}
