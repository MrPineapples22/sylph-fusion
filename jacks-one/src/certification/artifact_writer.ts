import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJsonStringify } from '../core/hashing.ts';
import type { HandCertificate } from './certificate.ts';
import type { ReproducibilityManifest } from './manifest.ts';

export function saveCertificate(cert: HandCertificate, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(cert, null, 2), 'utf-8');
}

export function saveManifest(manifest: ReproducibilityManifest, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
}
