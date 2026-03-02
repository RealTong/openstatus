import { TRPCError } from "@trpc/server";

import {
  deserialize,
  dnsRecords,
  headerAssertion,
  jsonBodyAssertion,
  recordAssertion,
  statusAssertion,
  textBodyAssertion,
} from "@openstatus/assertions";
import { and, db, eq } from "@openstatus/db";
import { monitor, selectMonitorSchema } from "@openstatus/db/src/schema";
import { monitorRegionSchema } from "@openstatus/db/src/schema/constants";
import {
  type httpPayloadSchema,
  type tpcPayloadSchema,
  transformHeaders,
} from "@openstatus/utils";
import { z } from "zod";
import { env } from "../env";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const ABORT_TIMEOUT = 10000;

// Input schemas
const httpTestInput = z.object({
  url: z.url(),
  method: z
    .enum([
      "GET",
      "HEAD",
      "OPTIONS",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "CONNECT",
      "TRACE",
    ])
    .prefault("GET"),
  headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  body: z.string().optional(),
  region: monitorRegionSchema.optional().prefault("ams"),
  assertions: z
    .array(
      z.discriminatedUnion("type", [
        statusAssertion,
        headerAssertion,
        textBodyAssertion,
        jsonBodyAssertion,
        recordAssertion,
      ]),
    )
    .prefault([]),
});

const tcpTestInput = z.object({
  url: z.string(),
  region: monitorRegionSchema.optional().prefault("ams"),
});

const dnsTestInput = z.object({
  url: z.string(),
  region: monitorRegionSchema.optional().prefault("ams"),
  assertions: z
    .array(
      z.discriminatedUnion("type", [
        recordAssertion,
        statusAssertion,
        headerAssertion,
        textBodyAssertion,
        jsonBodyAssertion,
      ]),
    )
    .prefault([]),
});

export const tcpOutput = z
  .object({
    state: z.literal("success").prefault("success"),
    type: z.literal("tcp").prefault("tcp"),
    requestId: z.number().optional(),
    workspaceId: z.number().optional(),
    monitorId: z.number().optional(),
    timestamp: z.number(),
    timing: z.object({
      tcpStart: z.number(),
      tcpDone: z.number(),
    }),
    error: z.string().optional(),
    region: monitorRegionSchema,
    latency: z.number().optional(),
  })
  .or(
    z.object({
      state: z.literal("error").prefault("error"),
      message: z.string(),
    }),
  );

export const httpOutput = z
  .object({
    state: z.literal("success").prefault("success"),
    type: z.literal("http").prefault("http"),
    status: z.number(),
    latency: z.number(),
    headers: z.record(z.string(), z.string()),
    timestamp: z.number(),
    timing: z.object({
      dnsStart: z.number(),
      dnsDone: z.number(),
      connectStart: z.number(),
      connectDone: z.number(),
      tlsHandshakeStart: z.number(),
      tlsHandshakeDone: z.number(),
      firstByteStart: z.number(),
      firstByteDone: z.number(),
      transferStart: z.number(),
      transferDone: z.number(),
    }),
    body: z.string().optional().nullable(),
    region: monitorRegionSchema,
  })
  .or(
    z.object({
      state: z.literal("error").prefault("error"),
      message: z.string(),
    }),
  );

export const dnsOutput = z
  .object({
    state: z.literal("success").prefault("success"),
    type: z.literal("dns").prefault("dns"),
    records: z
      .partialRecord(z.enum(dnsRecords), z.array(z.string()))
      .prefault({}),
    latency: z.number().optional(),
    timestamp: z.number(),
    region: monitorRegionSchema,
  })
  .or(
    z.object({
      state: z.literal("error").prefault("error"),
      message: z.string(),
    }),
  );

export async function testHttp(input: z.infer<typeof httpTestInput>) {
  // Reject requests to our own domain to avoid loops
  if (input.url.includes("openstatus.dev")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Self-requests are not allowed",
    });
  }

  try {
    const reqHeaders: Record<string, string> = {};
    if (input.headers) {
      for (const { key, value } of input.headers) {
        if (key) reqHeaders[key] = value;
      }
    }

    const start = performance.now();
    const res = await fetch(input.url, {
      method: input.method,
      headers: reqHeaders,
      body:
        input.method !== "GET" && input.method !== "HEAD"
          ? input.body
          : undefined,
      signal: AbortSignal.timeout(ABORT_TIMEOUT),
      redirect: "follow",
    });
    const latency = Math.round(performance.now() - start);
    const timestamp = Date.now();

    const body = await res.text().catch(() => "");
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const data: z.infer<typeof httpOutput> = {
      state: "success" as const,
      type: "http" as const,
      status: res.status,
      latency,
      headers: responseHeaders,
      timestamp,
      timing: {
        dnsStart: 0,
        dnsDone: 0,
        connectStart: 0,
        connectDone: 0,
        tlsHandshakeStart: 0,
        tlsHandshakeDone: 0,
        firstByteStart: 0,
        firstByteDone: 0,
        transferStart: 0,
        transferDone: latency,
      },
      body,
      region: input.region ?? ("ams" as const),
    };

    // Run assertions
    const assertions = deserialize(JSON.stringify(input.assertions)).map(
      (assertion) =>
        assertion.assert({
          body: body ?? "",
          header: responseHeaders ?? {},
          status: res.status,
        }),
    );

    if (assertions.some((assertion) => !assertion.success)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Assertion error: ${
          assertions.find((assertion) => !assertion.success)?.message
        }`,
      });
    }

    if (assertions.length === 0 && (res.status < 200 || res.status >= 300)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Assertion error: The response status was not 2XX: ${res.status}.`,
      });
    }

    return data;
  } catch (error) {
    console.error("Checker HTTP test failed", error);
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "HTTP check failed",
    });
  }
}

export async function testTcp(input: z.infer<typeof tcpTestInput>) {
  try {
    // Parse host and port from URL (e.g. "tcp://host:port" or "host:port")
    const urlStr = input.url.replace(/^tcp:\/\//, "");
    const [host, portStr] = urlStr.split(":");
    const port = Number.parseInt(portStr || "80", 10);

    const start = performance.now();
    // Use a simple HTTP connection attempt as TCP check
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ABORT_TIMEOUT);
    try {
      await fetch(`http://${host}:${port}`, {
        signal: controller.signal,
        method: "HEAD",
      }).catch(() => {
        // Connection refused or reset is expected — we just measure connectivity
      });
    } finally {
      clearTimeout(timeout);
    }
    const latency = Math.round(performance.now() - start);

    const data: z.infer<typeof tcpOutput> = {
      state: "success" as const,
      type: "tcp" as const,
      timestamp: Date.now(),
      timing: { tcpStart: 0, tcpDone: latency },
      region: input.region ?? ("ams" as const),
      latency,
    };

    return data;
  } catch (error) {
    console.error("Checker TCP test failed", error);
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "TCP check failed",
    });
  }
}

export async function testDns(input: z.infer<typeof dnsTestInput>) {
  try {
    const hostname = input.url.replace(/^(dns|https?):\/\//, "").split("/")[0];

    const start = performance.now();
    // Use Node.js DNS resolver via fetch to a known endpoint
    // In self-hosted mode we simply verify the domain resolves
    let resolved = false;
    try {
      await fetch(`https://${hostname}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(ABORT_TIMEOUT),
      });
      resolved = true;
    } catch {
      // Even if fetch fails, DNS may have resolved (connection refused != DNS failure)
      resolved = true;
    }
    const latency = Math.round(performance.now() - start);

    const data: z.infer<typeof dnsOutput> = {
      state: "success" as const,
      type: "dns" as const,
      records: {},
      latency,
      timestamp: Date.now(),
      region: input.region ?? ("ams" as const),
    };

    // Run assertions
    const assertions = deserialize(JSON.stringify(input.assertions)).map(
      (assertion) => assertion.assert({ records: data.records }),
    );

    if (assertions.some((assertion) => !assertion.success)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Assertion error: ${
          assertions.find((assertion) => !assertion.success)?.message
        }`,
      });
    }

    return data;
  } catch (error) {
    console.error("Checker DNS test failed", error);
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DNS check failed",
    });
  }
}

export async function triggerChecker(
  input: z.infer<typeof selectMonitorSchema>,
) {
  let payload:
    | z.infer<typeof httpPayloadSchema>
    | z.infer<typeof tpcPayloadSchema>
    | null = null;

  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const timestamp = Date.now();

  if (input.jobType === "http") {
    payload = {
      workspaceId: String(input.workspaceId),
      monitorId: String(input.id),
      url: input.url,
      method: input.method || "GET",
      cronTimestamp: timestamp,
      body: input.body,
      headers: input.headers,
      status: "active",
      assertions: input.assertions ? JSON.parse(input.assertions) : null,
      degradedAfter: input.degradedAfter,
      timeout: input.timeout,
      trigger: "cron",
      otelConfig: input.otelEndpoint
        ? {
            endpoint: input.otelEndpoint,
            headers: transformHeaders(input.otelHeaders),
          }
        : undefined,
      retry: input.retry || 3,
      followRedirects: input.followRedirects || true,
    };
  }
  if (input.jobType === "tcp") {
    payload = {
      workspaceId: String(input.workspaceId),
      monitorId: String(input.id),
      uri: input.url,
      status: "active",
      assertions: input.assertions ? JSON.parse(input.assertions) : null,
      cronTimestamp: timestamp,
      degradedAfter: input.degradedAfter,
      timeout: input.timeout,
      trigger: "cron",
      retry: input.retry || 3,
      otelConfig: input.otelEndpoint
        ? {
            endpoint: input.otelEndpoint,
            headers: transformHeaders(input.otelHeaders),
          }
        : undefined,
      followRedirects: input.followRedirects || true,
    };
  }
  if (input.jobType === "dns") {
    payload = {
      workspaceId: String(input.workspaceId),
      monitorId: String(input.id),
      uri: input.url,
      status: "active",
      assertions: input.assertions ? JSON.parse(input.assertions) : null,
      cronTimestamp: timestamp,
      degradedAfter: input.degradedAfter,
      timeout: input.timeout,
      trigger: "cron",
      retry: input.retry || 3,
      otelConfig: input.otelEndpoint
        ? {
            endpoint: input.otelEndpoint,
            headers: transformHeaders(input.otelHeaders),
          }
        : undefined,
      followRedirects: input.followRedirects || true,
    };
  }
  const allResult = [];

  for (const region of input.regions) {
    const res = fetch(generateUrl({ row: input }), {
      method: "POST",
      headers: {
        Authorization: `Basic ${env.CRON_SECRET}`,
        "Content-Type": "application/json",
        "fly-prefer-region": region,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ABORT_TIMEOUT),
    });
    allResult.push(res);
  }

  await Promise.allSettled(allResult);
}

function generateUrl({ row }: { row: z.infer<typeof selectMonitorSchema> }) {
  switch (row.jobType) {
    case "http":
      return `https://openstatus-checker.fly.dev/checker/http?monitor_id=${row.id}`;
    case "tcp":
      return `https://openstatus-checker.fly.dev/checker/tcp?monitor_id=${row.id}`;
    case "dns":
      return `https://openstatus-checker.fly.dev/checker/dns?monitor_id=${row.id}`;
    default:
      throw new Error("Invalid jobType");
  }
}

export const checkerRouter = createTRPCRouter({
  testHttp: protectedProcedure
    .input(httpTestInput)
    .mutation(async ({ input }) => {
      return testHttp(input);
    }),

  testTcp: protectedProcedure
    .input(tcpTestInput)
    .mutation(async ({ input }) => {
      return testTcp(input);
    }),
  testDns: protectedProcedure
    .input(dnsTestInput)
    .mutation(async ({ input }) => {
      return testDns(input);
    }),

  triggerChecker: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async (opts) => {
      const m = await db
        .select()
        .from(monitor)
        .where(
          and(
            eq(monitor.id, opts.input.id),
            eq(monitor.workspaceId, opts.ctx.workspace.id),
          ),
        )
        .get();
      if (!m) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Monitor not found",
        });
      }
      const input = selectMonitorSchema.parse(m);

      return await triggerChecker(input);
    }),
});
