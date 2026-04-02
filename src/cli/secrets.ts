import { randomBytes } from 'crypto';

export function generateHexSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
