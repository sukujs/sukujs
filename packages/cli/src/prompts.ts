import { emitKeypressEvents } from 'node:readline';
import { CliError } from './errors.js';

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

type Input = NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => unknown; isTTY?: boolean };
type Output = { write: (text: string) => unknown };

const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[39m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

/**
 * Questions for the terminal: arrow keys to move, space to toggle, enter to confirm. It has
 * no dependencies and reads keys from any stream, which is how the tests drive it.
 */
export class Prompter {
  constructor(
    private readonly input: Input = process.stdin,
    private readonly output: Output = process.stdout,
  ) {}

  /** Runs one question: draws it, feeds it keys until it returns a value, then tidies up. */
  private ask<T>(
    render: () => string[],
    onKey: (key: Key, text: string) => { done: T } | undefined,
    summary: (value: T) => string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const { input, output } = this;
      let lines = 0;
      const draw = (content: string[]) => {
        if (lines > 0) output.write(`\x1b[${lines}A\x1b[0J`);
        output.write(`${content.join('\n')}\n`);
        lines = content.length;
      };
      const finish = () => {
        input.off('keypress', listener);
        input.setRawMode?.(false);
        input.pause();
      };
      const listener = (text: string | undefined, key: Key = {}) => {
        if (key.ctrl && key.name === 'c') {
          finish();
          output.write('\n');
          reject(new CliError('Cancelled.'));
          return;
        }
        const result = onKey(key, text ?? '');
        if (result) {
          finish();
          draw([summary(result.done)]);
          resolve(result.done);
        } else {
          draw(render());
        }
      };
      emitKeypressEvents(input);
      input.setRawMode?.(true);
      input.resume();
      input.on('keypress', listener);
      draw(render());
    });
  }

  /** Free text. Enter with nothing typed accepts the default. */
  text(question: string, fallback = ''): Promise<string> {
    let value = '';
    return this.ask<string>(
      () => [`${bold(question)} ${value || dim(fallback)}`],
      (key, text) => {
        if (key.name === 'return' || key.name === 'enter')
          return { done: value.trim() || fallback };
        if (key.name === 'backspace') value = value.slice(0, -1);
        else if (text.length === 1 && text >= ' ') value += text;
        return undefined;
      },
      (answer) => `${bold(question)} ${cyan(answer)}`,
    );
  }

  /** Yes or no. */
  confirm(question: string, fallback = true): Promise<boolean> {
    return this.ask<boolean>(
      () => [`${bold(question)} ${dim(fallback ? '(Y/n)' : '(y/N)')}`],
      (key) => {
        if (key.name === 'return' || key.name === 'enter') return { done: fallback };
        if (key.name === 'y') return { done: true };
        if (key.name === 'n') return { done: false };
        return undefined;
      },
      (answer) => `${bold(question)} ${cyan(answer ? 'Yes' : 'No')}`,
    );
  }

  /** Pick one. The first choice is the default. */
  select<T>(question: string, choices: Choice<T>[]): Promise<T> {
    let at = 0;
    const move = (by: number) => {
      at = (at + by + choices.length) % choices.length;
    };
    return this.ask<T>(
      () => [
        `${bold(question)} ${dim('(arrows to move, enter to choose)')}`,
        ...choices.map((choice, index) => {
          const hint = choice.hint ? ` ${dim(choice.hint)}` : '';
          return index === at ? `${cyan(`> ${choice.label}`)}${hint}` : `  ${choice.label}${hint}`;
        }),
      ],
      (key) => {
        if (key.name === 'up' || key.name === 'k') move(-1);
        else if (key.name === 'down' || key.name === 'j') move(1);
        else if (key.name === 'return' || key.name === 'enter') {
          return { done: (choices[at] as Choice<T>).value };
        }
        return undefined;
      },
      (answer) =>
        `${bold(question)} ${cyan(choices.find((choice) => choice.value === answer)?.label ?? '')}`,
    );
  }

  /** Pick any number, including none. */
  multiselect<T>(question: string, choices: Choice<T>[]): Promise<T[]> {
    let at = 0;
    const picked = new Set<number>();
    return this.ask<T[]>(
      () => [
        `${bold(question)} ${dim('(space to toggle, enter to confirm)')}`,
        ...choices.map((choice, index) => {
          const box = picked.has(index) ? '[x]' : '[ ]';
          const hint = choice.hint ? ` ${dim(choice.hint)}` : '';
          const line = `${box} ${choice.label}`;
          return index === at ? `${cyan(`> ${line}`)}${hint}` : `  ${line}${hint}`;
        }),
      ],
      (key) => {
        if (key.name === 'up' || key.name === 'k') at = (at - 1 + choices.length) % choices.length;
        else if (key.name === 'down' || key.name === 'j') at = (at + 1) % choices.length;
        else if (key.name === 'space') {
          if (picked.has(at)) picked.delete(at);
          else picked.add(at);
        } else if (key.name === 'return' || key.name === 'enter') {
          return {
            done: [...picked]
              .sort((a, b) => a - b)
              .map((index) => (choices[index] as Choice<T>).value),
          };
        }
        return undefined;
      },
      (answer) => {
        const labels = choices
          .filter((choice) => answer.includes(choice.value))
          .map((c) => c.label);
        return `${bold(question)} ${cyan(labels.length > 0 ? labels.join(', ') : 'None')}`;
      },
    );
  }
}
