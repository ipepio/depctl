import { stdin, stdout } from 'process';

export interface SelectOption {
  label: string;
  value: string;
  detail?: string;
}

const CLEAR_LINE = '\x1B[2K\r';
const CURSOR_UP = (n: number): string => (n > 0 ? `\x1B[${n}A` : '');
const DIM = '\x1B[2m';
const BOLD = '\x1B[1m';
const CYAN = '\x1B[36m';
const RESET = '\x1B[0m';

function renderMenu(options: SelectOption[], selected: number, title: string): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${title}${RESET} ${DIM}(arrows to move, enter to select)${RESET}`);
  for (let i = 0; i < options.length; i++) {
    const prefix = i === selected ? `${CYAN}> ` : '  ';
    const label = i === selected ? `${BOLD}${options[i].label}${RESET}` : options[i].label;
    const detail = options[i].detail ? `${DIM} — ${options[i].detail}${RESET}` : '';
    lines.push(`${prefix}${label}${detail}${RESET}`);
  }
  return lines.join('\n');
}

function clearMenu(lineCount: number): void {
  stdout.write(CURSOR_UP(lineCount - 1));
  for (let i = 0; i < lineCount; i++) {
    stdout.write(CLEAR_LINE);
    if (i < lineCount - 1) stdout.write('\n');
  }
  stdout.write(CURSOR_UP(lineCount - 1));
}

export function selectFromList(options: SelectOption[], title: string): Promise<string> {
  if (!stdin.isTTY) {
    return Promise.reject(new Error('Interactive select requires a TTY'));
  }

  return new Promise((resolve) => {
    let selected = 0;
    const totalLines = options.length + 1;

    stdout.write(renderMenu(options, selected, title) + '\n');

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (key: string): void => {
      if (key === '\x1B[A') {
        selected = (selected - 1 + options.length) % options.length;
      } else if (key === '\x1B[B') {
        selected = (selected + 1) % options.length;
      } else if (key === '\r' || key === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        clearMenu(totalLines);
        stdout.write(`${BOLD}${title}${RESET} ${options[selected].label}\n`);
        resolve(options[selected].value);
        return;
      } else if (key === '\x03' || key === '\x1B') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        clearMenu(totalLines);
        resolve('__exit__');
        return;
      } else {
        return;
      }

      clearMenu(totalLines);
      stdout.write(renderMenu(options, selected, title) + '\n');
    };

    stdin.on('data', onData);
  });
}
