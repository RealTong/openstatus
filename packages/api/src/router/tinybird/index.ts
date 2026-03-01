/**
 * Replacement for the deleted Tinybird router utility functions.
 *
 * These factory functions return async callables that query the SQLite
 * `monitor_result` table instead of calling the Tinybird API.
 * They are used by the statusPage router (which uses publicProcedure,
 * so it can't call the protectedProcedure-based monitorData router directly).
 */

import { and, eq, gte, inArray, lte, sql } from "@openstatus/db";
import { db } from "@openstatus/db";
import { monitorResult } from "@openstatus/db/src/schema";
import { endOfDay, startOfDay, subDays } from "date-fns";

// ─── Helpers ───────────────────────────────────────────────────

function parseLatencies(csv: string | null): number[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * arr.length) - 1;
  return arr[Math.max(0, idx)];
}

function periodToSeconds(period: string): number {
  const map: Record<string, number> = {
    "1d": 86400,
    "7d": 604800,
    "14d": 1209600,
    "30d": 2592000,
    "45d": 3888000,
  };
  return map[period] ?? 86400;
}

// ─── Factory Functions (match old Tinybird API signatures) ────

type Type = "http" | "tcp" | "dns";

/**
 * getStatusProcedure — returns daily status counts per monitor.
 * Used by statusPage `getComponents` for the 45-day uptime bar.
 */
export function getStatusProcedure(_period: "45d", _type: Type) {
  return async (input: { monitorIds: string[] }) => {
    const periodDays = 45;
    const fromDate = startOfDay(subDays(new Date(), periodDays));
    const daySeconds = 86400;

    if (input.monitorIds.length === 0) return { data: [] };

    const rows = await db
      .select({
        monitorId: monitorResult.monitorId,
        day: sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${daySeconds}) * ${daySeconds}`.as(
          "day",
        ),
        count: sql<number>`COUNT(*)`,
        ok: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'success' THEN 1 ELSE 0 END)`,
        degraded: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'degraded' THEN 1 ELSE 0 END)`,
        error: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'error' THEN 1 ELSE 0 END)`,
      })
      .from(monitorResult)
      .where(
        and(
          inArray(
            monitorResult.monitorId,
            input.monitorIds.map(Number),
          ),
          gte(monitorResult.createdAt, fromDate),
        ),
      )
      .groupBy(monitorResult.monitorId, sql`day`)
      .orderBy(monitorResult.monitorId, sql`day`);

    const data = rows.map((r) => ({
      monitorId: r.monitorId.toString(),
      day: new Date(r.day * 1000).toISOString(),
      count: r.count,
      ok: r.ok,
      degraded: r.degraded,
      error: r.error,
    }));

    return { data };
  };
}

/**
 * getUptimeProcedure — returns bucketed uptime data.
 * Used by statusPage `getMonitor`.
 */
export function getUptimeProcedure(_period: "7d" | "30d", _type: Type) {
  return async (input: {
    monitorId: string;
    interval: number;
    fromDate: string;
    toDate: string;
  }) => {
    const intervalSeconds = input.interval * 60;
    const fromTs = Math.floor(new Date(input.fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(input.toDate).getTime() / 1000);

    const rows = await db
      .select({
        interval: sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
          "interval",
        ),
        success: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'success' THEN 1 ELSE 0 END)`,
        degraded: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'degraded' THEN 1 ELSE 0 END)`,
        error: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'error' THEN 1 ELSE 0 END)`,
      })
      .from(monitorResult)
      .where(
        and(
          eq(monitorResult.monitorId, Number(input.monitorId)),
          gte(monitorResult.createdAt, new Date(fromTs * 1000)),
          lte(monitorResult.createdAt, new Date(toTs * 1000)),
        ),
      )
      .groupBy(sql`interval`)
      .orderBy(sql`interval`);

    const data = rows.map((r) => ({
      ...r,
      interval: r.interval * 1000,
    }));

    return { data };
  };
}

/**
 * getMetricsLatencyProcedure — returns percentile latency for a single monitor.
 * Used by statusPage `getMonitor`.
 */
export function getMetricsLatencyProcedure(_period: string, _type: Type) {
  return async (input: {
    monitorId: string;
    fromDate: string;
    toDate: string;
  }) => {
    const fromTs = Math.floor(new Date(input.fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(input.toDate).getTime() / 1000);
    // 30-minute buckets
    const intervalSeconds = 1800;

    const rows = await db
      .select({
        bucket: sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
          "bucket",
        ),
        latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
          "latencies",
        ),
      })
      .from(monitorResult)
      .where(
        and(
          eq(monitorResult.monitorId, Number(input.monitorId)),
          gte(monitorResult.createdAt, new Date(fromTs * 1000)),
          lte(monitorResult.createdAt, new Date(toTs * 1000)),
        ),
      )
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`);

    const data = rows.map((r) => {
      const values = parseLatencies(r.latencies);
      return {
        timestamp: r.bucket * 1000,
        p50Latency: percentile(values, 50),
        p75Latency: percentile(values, 75),
        p90Latency: percentile(values, 90),
        p95Latency: percentile(values, 95),
        p99Latency: percentile(values, 99),
      };
    });

    return { data };
  };
}

/**
 * getMetricsLatencyMultiProcedure — returns percentile latency for multiple monitors.
 * Used by statusPage `getMonitors`.
 */
export function getMetricsLatencyMultiProcedure(_period: string, _type: Type) {
  return async (input: { monitorIds: string[] }) => {
    if (input.monitorIds.length === 0) return { data: [] };

    const now = Math.floor(Date.now() / 1000);
    const fromTs = now - periodToSeconds(_period);
    const intervalSeconds = 1800; // 30-minute buckets

    const rows = await db
      .select({
        monitorId: monitorResult.monitorId,
        bucket: sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
          "bucket",
        ),
        latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
          "latencies",
        ),
      })
      .from(monitorResult)
      .where(
        and(
          inArray(
            monitorResult.monitorId,
            input.monitorIds.map(Number),
          ),
          gte(monitorResult.createdAt, new Date(fromTs * 1000)),
        ),
      )
      .groupBy(monitorResult.monitorId, sql`bucket`)
      .orderBy(monitorResult.monitorId, sql`bucket`);

    const data = rows.map((r) => {
      const values = parseLatencies(r.latencies);
      return {
        monitorId: r.monitorId.toString(),
        timestamp: r.bucket * 1000,
        p50Latency: percentile(values, 50),
        p75Latency: percentile(values, 75),
        p90Latency: percentile(values, 90),
        p95Latency: percentile(values, 95),
        p99Latency: percentile(values, 99),
      };
    });

    return { data };
  };
}

/**
 * getMetricsRegionsProcedure — returns per-region percentile data.
 * Used by statusPage `getMonitor`.
 */
export function getMetricsRegionsProcedure(_period: string, _type: Type) {
  return async (input: {
    monitorId: string;
    fromDate: string;
    toDate: string;
  }) => {
    const fromTs = Math.floor(new Date(input.fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(input.toDate).getTime() / 1000);
    const intervalSeconds = 1800; // 30-minute buckets

    const rows = await db
      .select({
        region: monitorResult.region,
        bucket: sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
          "bucket",
        ),
        latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
          "latencies",
        ),
      })
      .from(monitorResult)
      .where(
        and(
          eq(monitorResult.monitorId, Number(input.monitorId)),
          gte(monitorResult.createdAt, new Date(fromTs * 1000)),
          lte(monitorResult.createdAt, new Date(toTs * 1000)),
        ),
      )
      .groupBy(monitorResult.region, sql`bucket`)
      .orderBy(monitorResult.region, sql`bucket`);

    const data = rows.map((r) => {
      const values = parseLatencies(r.latencies);
      return {
        region: r.region,
        timestamp: r.bucket * 1000,
        p50Latency: percentile(values, 50),
        p75Latency: percentile(values, 75),
        p90Latency: percentile(values, 90),
        p95Latency: percentile(values, 95),
        p99Latency: percentile(values, 99),
      };
    });

    return { data };
  };
}
