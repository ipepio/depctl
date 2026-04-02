import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { CliUsageError } from './errors';

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function resolveRequiredString(
  value: string | undefined,
  prompt: string,
  fallback?: string,
): Promise<string> {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  if (!process.stdin.isTTY) {
    throw new CliUsageError(`Missing required argument: ${prompt}`);
  }

  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await ask(`${prompt}${suffix}: `)).trim();
  if (answer.length > 0) {
    return answer;
  }

  if (fallback) {
    return fallback;
  }

  throw new CliUsageError(`Missing required argument: ${prompt}`);
}

export async function resolveOptionalString(
  value: string | undefined,
  prompt: string,
  fallback?: string,
): Promise<string | undefined> {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  if (!process.stdin.isTTY) {
    return fallback;
  }

  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await ask(`${prompt}${suffix}: `)).trim();
  if (answer.length > 0) {
    return answer;
  }

  return fallback;
}

export async function resolveList(
  values: string[] | undefined,
  prompt: string,
  fallback: string[] = [],
): Promise<string[]> {
  if (values && values.length > 0) {
    return values;
  }

  if (!process.stdin.isTTY) {
    return fallback;
  }

  const suffix = fallback.length > 0 ? ` [${fallback.join(',')}]` : '';
  const answer = (await ask(`${prompt}${suffix}: `)).trim();
  if (!answer) {
    return fallback;
  }

  return answer
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function confirm(prompt: string, defaultValue = false): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return defaultValue;
  }

  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = (await ask(`${prompt}${suffix}: `)).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  return ['y', 'yes'].includes(answer);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
