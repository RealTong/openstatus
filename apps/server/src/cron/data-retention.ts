/**
 * Data retention cron job — periodically deletes old monitor_result records.
 *
 * Configurable via DATA_RETENTION_DAYS environment variable (default: 90 days).
 * Runs once per day when the server starts, then every 24 hours.
 */

import { lt, sql } from "@openstatus/db";
import { db } from "@openstatus/db";
import { monitorResult } from "@openstatus/db/src/schema";

const DEFAULT_RETENTION_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getRetentionDays(): number {
  const envVal = process.env.DATA_RETENTION_DAYS;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_RETENTION_DAYS;
}

async function cleanupOldResults() {
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * ONE_DAY_MS);

  try {
    const result = await db
      .delete(monitorResult)
      .where(lt(monitorResult.createdAt, cutoff));

    console.log(
      `[data-retention] Deleted monitor results older than ${retentionDays} days (before ${cutoff.toISOString()})`,
    );
  } catch (err) {
    console.error("[data-retention] Failed to cleanup old results:", err);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the data retention cron job.
 * Runs cleanup immediately, then every 24 hours.
 */
export function startDataRetentionCron() {
  // Run once on startup (delayed by 10 seconds to avoid startup contention)
  setTimeout(cleanupOldResults, 10_000);

  // Then run every 24 hours
  intervalHandle = setInterval(cleanupOldResults, ONE_DAY_MS);
  console.log(
    `[data-retention] Started. Retention: ${getRetentionDays()} days`,
  );
}

/**
 * Stop the data retention cron job.
 */
export function stopDataRetentionCron() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
