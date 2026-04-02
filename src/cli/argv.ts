export interface ParsedCommandArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function parseCommandArgs(args: string[]): ParsedCommandArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const rawFlag = arg.slice(2);
    const [rawKey, inlineValue] = rawFlag.split('=', 2);
    const key = toCamelCase(rawKey);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return {
    positionals,
    flags,
  };
}

export function getStringFlag(parsed: ParsedCommandArgs, key: string): string | undefined {
  const value = parsed.flags[key];
  return typeof value === 'string' ? value : undefined;
}

export function getBooleanFlag(parsed: ParsedCommandArgs, key: string): boolean {
  const value = parsed.flags[key];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  return false;
}

export function getListFlag(parsed: ParsedCommandArgs, key: string): string[] | undefined {
  const value = getStringFlag(parsed, key);
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
