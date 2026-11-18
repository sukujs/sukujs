import { feature } from '@sukujs/core';
import { BooksRoutes } from './books.routes';
import { BooksService } from './books.service';

export const BooksFeature = feature('books', {
  routes: [BooksRoutes],
  services: [BooksService],
});
