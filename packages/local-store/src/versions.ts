import type { VersionSnapshot, VersionTier } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * App-called automatic Version policy (not a daemon):
 * hourly for 24 hours, daily for 30 days, weekly for one year.
 * Returns the tier to save now, or null if a snapshot already covers this bucket.
 */
export function selectAutomaticVersionTier(
  nowUnixMs: number,
  existing: readonly Pick<VersionSnapshot, 'tier' | 'createdWallMs'>[],
): Exclude<VersionTier, 'manual'> | null {
  const hasRecent = (tier: Exclude<VersionTier, 'manual'>, windowMs: number): boolean =>
    existing.some((row) => row.tier === tier && nowUnixMs - row.createdWallMs < windowMs);

  if (!hasRecent('hourly', HOUR_MS)) {
    return 'hourly';
  }
  if (!hasRecent('daily', DAY_MS)) {
    return 'daily';
  }
  if (!hasRecent('weekly', WEEK_MS)) {
    return 'weekly';
  }
  return null;
}
