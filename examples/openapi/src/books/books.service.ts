import { NotFoundException, Service } from '@sukujs/core';
import type { Book, NewBook } from './books.schemas';

@Service()
export class BooksService {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune', author: 'Frank Herbert', year: 1965 },
    { id: 2, title: 'Emma', author: 'Jane Austen', year: 1815 },
  ];

  list(author: string | undefined, limit: number): Book[] {
    return this.books.filter((book) => !author || book.author === author).slice(0, limit);
  }

  find(id: number): Book {
    const book = this.books.find((b) => b.id === id);
    if (!book) throw new NotFoundException(`No book with id ${id}`);
    return book;
  }

  add(input: NewBook): Book {
    const book = { id: this.books.length + 1, ...input };
    this.books.push(book);
    return book;
  }

  remove(id: number): void {
    this.books.splice(this.books.indexOf(this.find(id)), 1);
  }
}
