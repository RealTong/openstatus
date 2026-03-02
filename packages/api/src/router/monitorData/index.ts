import { and, desc, eq, gte, inArray, lte, sql } from "@openstatus/db";
import { monitorResult } from "@openstatus/db/src/schema";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

/**
 * monitorData router — replaces the deleted tinybird router.
 *
 * Every endpoint returns `{ data: T[] }` to match the shape the Dashboard
 * components already consume (RouterOutputs["tinybird"][...]).
 */
export const monitorDataRouter = createTRPCRouter({
  /**
   * metrics — GlobalUptimeSection component uses this.
   * Returns aggregated metrics (percentiles, uptime counts) for a monitor,
   * split into two time buckets: the selected period and the previous period
   * (for trend comparison).
   */
  metrics: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        period: z.enum(["1d", "7d", "14d"]),
        type: z.enum(["http", "tcp", "dns"]),
        regions: z.array(z.string()).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const periodSeconds = periodToSeconds(input.period);
      const now = Math.floor(Date.now() / 1000);
      const periodStart = now - periodSeconds;
      const prevPeriodStart = periodStart - periodSeconds;

      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
      ];
      const regions = normalizeRegions(input.regions);

      if (regions.length) {
        conditions.push(inArray(monitorResult.region, regions));
      }

      // Fetch two periods: current and previous (for trend)
      const rows = await ctx.db
        .select({
          bucket:
            sql<number>`CASE WHEN ${monitorResult.createdAt} >= ${periodStart} THEN 1 ELSE 0 END`.as(
              "bucket",
            ),
          count: sql<number>`COUNT(*)`,
          success: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'success' THEN 1 ELSE 0 END)`,
          degraded: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'degraded' THEN 1 ELSE 0 END)`,
          error: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'error' THEN 1 ELSE 0 END)`,
          lastTimestamp: sql<number>`MAX(${monitorResult.createdAt})`,
        })
        .from(monitorResult)
        .where(
          and(
            ...conditions,
            gte(monitorResult.createdAt, new Date(prevPeriodStart * 1000)),
          ),
        )
        .groupBy(sql`bucket`);

      // Compute percentiles per bucket
      const percentiles = await Promise.all(
        [0, 1].map((bucket) =>
          computePercentiles(
            ctx.db,
            Number(input.monitorId),
            ctx.workspace.id,
            bucket === 1
              ? new Date(periodStart * 1000)
              : new Date(prevPeriodStart * 1000),
            bucket === 1 ? new Date(now * 1000) : new Date(periodStart * 1000),
            regions,
          ),
        ),
      );

      const data = [0, 1].map((bucket) => {
        const row = rows.find((r) => r.bucket === bucket) ?? {
          count: 0,
          success: 0,
          degraded: 0,
          error: 0,
          lastTimestamp: 0,
        };
        const p = percentiles[bucket];
        return {
          p50Latency: p?.p50 ?? 0,
          p75Latency: p?.p75 ?? 0,
          p90Latency: p?.p90 ?? 0,
          p95Latency: p?.p95 ?? 0,
          p99Latency: p?.p99 ?? 0,
          count: row.count,
          success: row.success,
          degraded: row.degraded,
          error: row.error,
          lastTimestamp: (row.lastTimestamp ?? 0) * 1000, // convert to ms
        };
      });

      return { data };
    }),

  /**
   * uptime — ChartBarUptime component uses this.
   * Returns success/degraded/error counts bucketed by time interval.
   */
  uptime: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        // Allow flexible date range or period-based queries
        period: z.enum(["1d", "7d", "14d", "30d", "45d"]).optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        interval: z.number().default(1440), // minutes
        regions: z.array(z.string()).nullish(),
        type: z.enum(["http", "tcp", "dns"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const intervalSeconds = input.interval * 60;
      const { fromTs, toTs } = resolveTimeRange(
        input.fromDate,
        input.toDate,
        input.period,
      );

      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
        gte(monitorResult.createdAt, new Date(fromTs * 1000)),
        lte(monitorResult.createdAt, new Date(toTs * 1000)),
      ];
      const regions = normalizeRegions(input.regions);

      if (regions.length) {
        conditions.push(inArray(monitorResult.region, regions));
      }

      const rows = await ctx.db
        .select({
          interval:
            sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
              "interval",
            ),
          success: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'success' THEN 1 ELSE 0 END)`,
          degraded: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'degraded' THEN 1 ELSE 0 END)`,
          error: sql<number>`SUM(CASE WHEN ${monitorResult.requestStatus} = 'error' THEN 1 ELSE 0 END)`,
        })
        .from(monitorResult)
        .where(and(...conditions))
        .groupBy(sql`interval`)
        .orderBy(sql`interval`);

      const data = rows.map((r) => ({
        ...r,
        interval: new Date(r.interval * 1000), // convert to Date
      }));

      return { data };
    }),

  /**
   * metricsLatency — ChartAreaLatency component uses this.
   * Returns percentile latency values bucketed by time.
   */
  metricsLatency: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        period: z.enum(["1d", "7d", "14d"]),
        type: z.enum(["http", "tcp", "dns"]).optional(),
        regions: z.array(z.string()).nullish(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const intervalMinutes = periodToIntervalMinutes(input.period);
      const intervalSeconds = intervalMinutes * 60;
      const { fromTs, toTs } = resolveTimeRange(
        input.fromDate,
        input.toDate,
        input.period,
      );

      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
        gte(monitorResult.createdAt, new Date(fromTs * 1000)),
        lte(monitorResult.createdAt, new Date(toTs * 1000)),
      ];
      const regions = normalizeRegions(input.regions);

      if (regions.length) {
        conditions.push(inArray(monitorResult.region, regions));
      }

      const rows = await ctx.db
        .select({
          bucket:
            sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
              "bucket",
            ),
          latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
            "latencies",
          ),
        })
        .from(monitorResult)
        .where(and(...conditions))
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
    }),

  /**
   * metricsTimingPhases — ChartAreaTimingPhases component uses this.
   * Returns timing phase percentiles bucketed by time.
   */
  metricsTimingPhases: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        period: z.enum(["1d", "7d", "14d"]),
        type: z.enum(["http"]).optional(),
        interval: z.number().optional(),
        regions: z.array(z.string()).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const intervalMinutes =
        input.interval ?? periodToIntervalMinutes(input.period);
      const intervalSeconds = intervalMinutes * 60;
      const periodSeconds = periodToSeconds(input.period);
      const now = Math.floor(Date.now() / 1000);
      const fromTs = now - periodSeconds;

      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
        gte(monitorResult.createdAt, new Date(fromTs * 1000)),
      ];
      const regions = normalizeRegions(input.regions);

      if (regions.length) {
        conditions.push(inArray(monitorResult.region, regions));
      }

      const rows = await ctx.db
        .select({
          bucket:
            sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
              "bucket",
            ),
          dnsValues: sql<string>`GROUP_CONCAT(${monitorResult.timingDns})`.as(
            "dns_values",
          ),
          connectValues:
            sql<string>`GROUP_CONCAT(${monitorResult.timingConnection})`.as(
              "connect_values",
            ),
          tlsValues: sql<string>`GROUP_CONCAT(${monitorResult.timingTls})`.as(
            "tls_values",
          ),
          ttfbValues: sql<string>`GROUP_CONCAT(${monitorResult.timingTtfb})`.as(
            "ttfb_values",
          ),
          transferValues:
            sql<string>`GROUP_CONCAT(${monitorResult.timingTransfer})`.as(
              "transfer_values",
            ),
        })
        .from(monitorResult)
        .where(and(...conditions))
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      const data = rows.map((r) => {
        const dns = parseLatencies(r.dnsValues);
        const connect = parseLatencies(r.connectValues);
        const tls = parseLatencies(r.tlsValues);
        const ttfb = parseLatencies(r.ttfbValues);
        const transfer = parseLatencies(r.transferValues);

        return {
          timestamp: r.bucket * 1000,
          p50Dns: percentile(dns, 50),
          p50Connect: percentile(connect, 50),
          p50Tls: percentile(tls, 50),
          p50Ttfb: percentile(ttfb, 50),
          p50Transfer: percentile(transfer, 50),
          p75Dns: percentile(dns, 75),
          p75Connect: percentile(connect, 75),
          p75Tls: percentile(tls, 75),
          p75Ttfb: percentile(ttfb, 75),
          p75Transfer: percentile(transfer, 75),
          p90Dns: percentile(dns, 90),
          p90Connect: percentile(connect, 90),
          p90Tls: percentile(tls, 90),
          p90Ttfb: percentile(ttfb, 90),
          p90Transfer: percentile(transfer, 90),
          p95Dns: percentile(dns, 95),
          p95Connect: percentile(connect, 95),
          p95Tls: percentile(tls, 95),
          p95Ttfb: percentile(ttfb, 95),
          p95Transfer: percentile(transfer, 95),
          p99Dns: percentile(dns, 99),
          p99Connect: percentile(connect, 99),
          p99Tls: percentile(tls, 99),
          p99Ttfb: percentile(ttfb, 99),
          p99Transfer: percentile(transfer, 99),
        };
      });

      return { data };
    }),

  /**
   * metricsRegions — Monitor overview page uses this for regional breakdown.
   * Returns per-region percentile data bucketed by time.
   */
  metricsRegions: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        period: z.enum(["1d", "7d", "14d"]),
        type: z.enum(["http", "tcp", "dns"]).optional(),
        regions: z.array(z.string()).nullish(),
        interval: z.number().default(30), // minutes
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const intervalSeconds = input.interval * 60;
      const { fromTs, toTs } = resolveTimeRange(
        input.fromDate,
        input.toDate,
        input.period,
      );

      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
        gte(monitorResult.createdAt, new Date(fromTs * 1000)),
        lte(monitorResult.createdAt, new Date(toTs * 1000)),
      ];
      const regions = normalizeRegions(input.regions);

      if (regions.length) {
        conditions.push(inArray(monitorResult.region, regions));
      }

      const rows = await ctx.db
        .select({
          region: monitorResult.region,
          timestamp:
            sql<number>`(CAST(${monitorResult.createdAt} AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds}`.as(
              "timestamp",
            ),
          latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
            "latencies",
          ),
        })
        .from(monitorResult)
        .where(and(...conditions))
        .groupBy(monitorResult.region, sql`timestamp`)
        .orderBy(monitorResult.region, sql`timestamp`);

      const data = rows.map((r) => {
        const values = parseLatencies(r.latencies);
        return {
          region: r.region,
          timestamp: r.timestamp * 1000,
          p50Latency: percentile(values, 50),
          p75Latency: percentile(values, 75),
          p90Latency: percentile(values, 90),
          p95Latency: percentile(values, 95),
          p99Latency: percentile(values, 99),
        };
      });

      return { data };
    }),

  /**
   * globalMetrics — Monitor list page uses this.
   * Returns p95 latency per monitor for the last 24h.
   */
  globalMetrics: protectedProcedure
    .input(
      z.object({
        monitorIds: z.array(z.string()),
        type: z.enum(["http", "tcp", "dns"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.monitorIds.length === 0) return { data: [] };

      const now = Math.floor(Date.now() / 1000);
      const oneDayAgo = now - 86400;

      const rows = await ctx.db
        .select({
          monitorId: monitorResult.monitorId,
          latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
            "latencies",
          ),
          lastTimestamp:
            sql<number>`MAX(CAST(${monitorResult.createdAt} AS INTEGER))`.as(
              "last_timestamp",
            ),
        })
        .from(monitorResult)
        .where(
          and(
            inArray(monitorResult.monitorId, input.monitorIds.map(Number)),
            eq(monitorResult.workspaceId, ctx.workspace.id),
            gte(monitorResult.createdAt, new Date(oneDayAgo * 1000)),
          ),
        )
        .groupBy(monitorResult.monitorId);

      const data = rows.map((r) => {
        const values = parseLatencies(r.latencies);
        return {
          monitorId: r.monitorId.toString(),
          p50Latency: percentile(values, 50),
          p75Latency: percentile(values, 75),
          p90Latency: percentile(values, 90),
          p95Latency: percentile(values, 95),
          p99Latency: percentile(values, 99),
          count: values.length,
          lastTimestamp: (r.lastTimestamp ?? 0) * 1000,
        };
      });

      return { data };
    }),

  /**
   * list — Response logs page uses this.
   * Returns raw check results for a monitor with optional date filtering.
   */
  list: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        from: z.string().nullish(),
        to: z.string().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(monitorResult.monitorId, Number(input.monitorId)),
        eq(monitorResult.workspaceId, ctx.workspace.id),
      ];

      if (input.from) {
        conditions.push(gte(monitorResult.createdAt, new Date(input.from)));
      }
      if (input.to) {
        conditions.push(lte(monitorResult.createdAt, new Date(input.to)));
      }

      const rows = await ctx.db
        .select()
        .from(monitorResult)
        .where(and(...conditions))
        .orderBy(desc(monitorResult.createdAt))
        .limit(1000);

      const data = rows.map(mapResultToResponseLog);

      return { data };
    }),

  /**
   * get — Response log detail sheet uses this.
   * Returns a single check result by id.
   */
  get: protectedProcedure
    .input(
      z.object({
        id: z.string().nullish(),
        monitorId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.id) return { data: [] };

      const rows = await ctx.db
        .select()
        .from(monitorResult)
        .where(
          and(
            eq(monitorResult.id, Number(input.id)),
            eq(monitorResult.workspaceId, ctx.workspace.id),
          ),
        )
        .limit(1);

      const data = rows.map(mapResultToResponseLog);

      return { data };
    }),

  /**
   * auditLog — Timeline section on monitor overview page.
   * Returns status change events (transitions between success/degraded/error).
   */
  auditLog: protectedProcedure
    .input(
      z.object({
        monitorId: z.string(),
        interval: z.number().default(30), // days
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const fromTs = now - input.interval * 86400;

      // Get all results ordered by time to detect status transitions
      const rows = await ctx.db
        .select({
          id: monitorResult.id,
          region: monitorResult.region,
          requestStatus: monitorResult.requestStatus,
          statusCode: monitorResult.statusCode,
          message: monitorResult.message,
          createdAt: monitorResult.createdAt,
        })
        .from(monitorResult)
        .where(
          and(
            eq(monitorResult.monitorId, Number(input.monitorId)),
            eq(monitorResult.workspaceId, ctx.workspace.id),
            gte(monitorResult.createdAt, new Date(fromTs * 1000)),
          ),
        )
        .orderBy(monitorResult.createdAt);

      // Detect status transitions per region and map to audit log format
      const data: {
        action: string;
        metadata: Record<string, string | number>;
        timestamp: number;
      }[] = [];

      const lastStatusByRegion = new Map<string, string>();

      for (const row of rows) {
        const prevStatus = lastStatusByRegion.get(row.region);
        if (prevStatus !== row.requestStatus) {
          const action = mapStatusTransitionToAction(
            prevStatus,
            row.requestStatus,
          );
          const createdAtTs =
            row.createdAt instanceof Date
              ? row.createdAt.getTime()
              : (row.createdAt as unknown as number) * 1000;

          data.push({
            action,
            metadata: {
              region: row.region,
              ...(row.statusCode != null ? { statusCode: row.statusCode } : {}),
              latency: 0,
            },
            timestamp: createdAtTs,
          });
          lastStatusByRegion.set(row.region, row.requestStatus);
        }
      }

      return { data };
    }),
});

// ─── Helpers ───────────────────────────────────────────────────

function mapStatusTransitionToAction(
  prevStatus: string | undefined,
  newStatus: string,
): string {
  if (newStatus === "error") return "monitor.failed";
  if (newStatus === "degraded") return "monitor.degraded";
  if (prevStatus === "error" || prevStatus === "degraded") {
    return "monitor.recovered";
  }
  return "monitor.recovered";
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

function periodToIntervalMinutes(period: string): number {
  const map: Record<string, number> = {
    "1d": 60,
    "7d": 240,
    "14d": 480,
  };
  return map[period] ?? 60;
}

function resolveTimeRange(
  fromDate?: string,
  toDate?: string,
  period?: string,
): { fromTs: number; toTs: number } {
  const now = Math.floor(Date.now() / 1000);
  const toTs = toDate ? Math.floor(new Date(toDate).getTime() / 1000) : now;
  const fromTs = fromDate
    ? Math.floor(new Date(fromDate).getTime() / 1000)
    : now - periodToSeconds(period ?? "7d");
  return { fromTs, toTs };
}

function normalizeRegions(regions: string[] | null | undefined): string[] {
  if (!regions?.length) return [];
  return regions.filter((region) => {
    const value = region?.trim();
    return !!value && value !== "undefined" && value !== "null";
  });
}

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

async function computePercentiles(
  // biome-ignore lint/suspicious/noExplicitAny: complex drizzle db type
  db: any,
  monitorId: number,
  workspaceId: number,
  from: Date,
  to: Date,
  regions?: string[],
): Promise<{
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}> {
  const conditions = [
    eq(monitorResult.monitorId, monitorId),
    eq(monitorResult.workspaceId, workspaceId),
    gte(monitorResult.createdAt, from),
    lte(monitorResult.createdAt, to),
  ];

  if (regions?.length) {
    conditions.push(inArray(monitorResult.region, regions));
  }

  const rows = await db
    .select({
      latencies: sql<string>`GROUP_CONCAT(${monitorResult.latency})`.as(
        "latencies",
      ),
    })
    .from(monitorResult)
    .where(and(...conditions));

  const values = parseLatencies(rows[0]?.latencies ?? "");

  return {
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

type BaseResponseLog = {
  id: string;
  url: string;
  method: string;
  statusCode: number;
  requestStatus: "success" | "degraded" | "error";
  latency: number;
  timing: {
    dns: number;
    connect: number;
    tls: number;
    ttfb: number;
    transfer: number;
  };
  assertions: unknown[] | string;
  region: string;
  error: boolean;
  timestamp: number;
  headers: Record<string, string>;
  workspaceId: string;
  monitorId: string;
  cronTimestamp: number;
  trigger: "cron" | "api";
  message: string | null;
  body: string | null;
  uri: string | null;
  // TCP-specific
  errorMessage: string | null;
  // DNS-specific
  records: Record<string, string | string[]> | null;
};

export type ResponseLogEntry =
  | (BaseResponseLog & { type: "http" })
  | (BaseResponseLog & { type: "tcp" })
  | (BaseResponseLog & { type: "dns" });

/**
 * Maps a raw DB row to the response log shape expected by the Dashboard.
 * This matches the old Tinybird `list`/`get` response format.
 * Returns a discriminated union so Extract<ResponseLog, { type: "http" }> works.
 */
function mapResultToResponseLog(
  row: typeof monitorResult.$inferSelect,
): ResponseLogEntry {
  const createdAtTs =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : (row.createdAt as number) * 1000;

  return {
    id: row.id.toString(),
    type: row.jobType,
    url: "",
    method: "",
    statusCode: row.statusCode ?? 0,
    requestStatus: row.requestStatus,
    latency: row.latency,
    timing: {
      dns: row.timingDns ?? 0,
      connect: row.timingConnection ?? 0,
      tls: row.timingTls ?? 0,
      ttfb: row.timingTtfb ?? 0,
      transfer: row.timingTransfer ?? 0,
    },
    assertions: [],
    region: row.region,
    error: row.requestStatus === "error",
    timestamp: createdAtTs,
    headers: {},
    workspaceId: row.workspaceId.toString(),
    monitorId: row.monitorId.toString(),
    cronTimestamp: createdAtTs,
    trigger: (row.trigger ?? "cron") as "cron" | "api",
    message: row.message ?? null,
    body: null,
    uri: null,
    errorMessage: null,
    records: null,
  } as ResponseLogEntry;
}
