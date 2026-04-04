import { type ParsedCommandArgs } from '../argv';
import { getBooleanFlag, getStringFlag } from '../argv';
import { printJson } from '../io';
import { runInit } from '../use-cases/instance-init';
import { runStatus, formatStatus } from '../use-cases/instance-status';

export async function handleInit(parsed: ParsedCommandArgs): Promise<number> {
  const result = await runInit({
    publicUrl: getStringFlag(parsed, 'publicUrl') ?? getStringFlag(parsed, 'url'),
    port: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
    stacksRoot: getStringFlag(parsed, 'stacksRoot') ?? getStringFlag(parsed, 'stacks'),
    nonInteractive: getBooleanFlag(parsed, 'nonInteractive'),
  });
  printJson(result);
  return 0;
}

export async function handleStatus(parsed: ParsedCommandArgs): Promise<number> {
  const useJson = getBooleanFlag(parsed, 'json');
  const status = runStatus();
  if (useJson) { printJson(status); } else { process.stdout.write(formatStatus(status)); }
  return 0;
}
