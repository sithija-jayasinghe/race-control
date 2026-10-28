import { createHash, randomBytes } from 'node:crypto';

/** A random, URL-safe secret with 256 bits of entropy, e.g. for magic links and login cookies. */
export function createSecureToken(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url');
}

/**
 * SHA-256 of a token, for storage and lookup. Only the hash is ever stored.
 * A plain hash is enough (no salt or slow hash) because the tokens are random, not passwords.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
