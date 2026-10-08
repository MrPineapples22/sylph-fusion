/**
 * Restricted Store projection bridge for Engine. The C1 source auditor requires
 * src/fusion.ts to be its sole production importer. This boundary is a repository
 * trust boundary, not a sandbox against arbitrary same-process JavaScript.
 */
import { getInternalEngineProjectionCapability, type EngineProjectionCapability } from '../../store.js';

export function getEngineProjectionCapability(value: unknown): EngineProjectionCapability | null {
  return getInternalEngineProjectionCapability(value);
}
