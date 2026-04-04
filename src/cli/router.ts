import { type ParsedCommandArgs } from './argv';
import { CliUsageError } from './errors';

export interface CommandHandler {
  (parsed: ParsedCommandArgs): Promise<number>;
}

export interface CommandEntry {
  key: string; // e.g. "repo" or "repo secrets show"
  handler: CommandHandler;
}

export class CommandRouter {
  private readonly registry = new Map<string, CommandHandler>();

  register(key: string, handler: CommandHandler): void {
    this.registry.set(key, handler);
  }

  async dispatch(parsed: ParsedCommandArgs): Promise<number> {
    // Try most-specific key first (up to 3 positional tokens)
    for (let depth = Math.min(parsed.positionals.length, 3); depth >= 1; depth--) {
      const key = parsed.positionals.slice(0, depth).join(' ');
      const handler = this.registry.get(key);
      if (handler) {
        return handler(parsed);
      }
    }

    throw new CliUsageError('Unknown command. Run: depctl help');
  }
}
