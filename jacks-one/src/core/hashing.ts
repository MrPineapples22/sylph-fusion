import { createHash } from 'node:crypto';

/**
 * Deterministic JSON stringification and cryptographic hashing.
 * Sorts object keys recursively to ensure consistent serialization.
 */

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });

  return '{' + pairs.join(',') + '}';
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashCanonicalObject(obj: unknown): string {
  const json = canonicalJsonStringify(obj);
  return sha256Hex(json);
}
