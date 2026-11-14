import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CliError } from './errors.js';

export interface Change {
  action: 'CREATE' | 'UPDATE';
  /** Relative to the plan's root, with forward slashes. */
  path: string;
  content: string;
}

export interface CommitOptions {
  dryRun?: boolean;
  force?: boolean;
  log?: (line: string) => void;
}

/**
 * Collects every file a command wants to write, then writes them together. Nothing touches
 * the disk until `commit`, so a command either does all of its work or none of it.
 */
export class Plan {
  readonly changes: Change[] = [];
  readonly notes: string[] = [];

  constructor(readonly root: string) {}

  private key(path: string): string {
    return relative(this.root, join(this.root, path)).split('\\').join('/');
  }

  exists(path: string): boolean {
    return this.read(path) !== undefined;
  }

  /** The planned content of a file if this plan changes it, otherwise what is on disk. */
  read(path: string): string | undefined {
    const key = this.key(path);
    const planned = this.changes.find((change) => change.path === key);
    if (planned) return planned.content;
    const absolute = join(this.root, key);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
  }

  create(path: string, content: string): void {
    this.changes.push({ action: 'CREATE', path: this.key(path), content });
  }

  update(path: string, content: string): void {
    const key = this.key(path);
    const planned = this.changes.find((change) => change.path === key);
    if (planned) planned.content = content;
    else this.changes.push({ action: 'UPDATE', path: key, content });
  }

  note(message: string): void {
    this.notes.push(message);
  }

  commit(options: CommitOptions = {}): void {
    const log = options.log ?? console.log;
    if (!options.force) {
      const taken = this.changes.filter(
        (change) => change.action === 'CREATE' && existsSync(join(this.root, change.path)),
      );
      if (taken.length > 0) {
        throw new CliError(
          `Refusing to overwrite ${taken.map((change) => change.path).join(', ')}. Pass --force to replace.`,
        );
      }
    }
    for (const change of this.changes) {
      if (!options.dryRun) {
        const absolute = join(this.root, change.path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, change.content);
      }
      log(`${change.action} ${change.path} (${Buffer.byteLength(change.content)} bytes)`);
    }
    for (const note of this.notes) log(`NOTE   ${note}`);
    if (options.dryRun) log('Dry run: nothing was written.');
  }
}
