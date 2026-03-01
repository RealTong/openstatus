import { createRoute, z } from "@hono/zod-openapi";

import { and, db, eq, isNull, sql } from "@openstatus/db";
import { monitor } from "@openstatus/db/src/schema";

// import { serialize } from "@openstatus/assertions";

import { OpenStatusApiError, openApiErrorResponses } from "@/libs/errors";
import type { monitorsApi } from "./index";
import { DNSMonitorSchema, MonitorSchema } from "./schema";
// import { getAssertionNew } from "./utils";

const postRoute = createRoute({
  method: "post",
  tags: ["monitor"],
  summary: "Create a  dns monitor",
  path: "/dns",
  request: {
    body: {
      description: "The monitor to create",
      content: {
        "application/json": {
          schema: DNSMonitorSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MonitorSchema,
        },
      },
      description: "Create a monitor",
    },
    ...openApiErrorResponses,
  },
});

export function registerPostMonitorDNS(api: typeof monitorsApi) {
  return api.openapi(postRoute, async (c) => {
    const workspaceId = c.get("workspace").id;
    const input = c.req.valid("json");

    const { request, regions, assertions, openTelemetry, ...rest } = input;

    const otelHeadersEntries = openTelemetry?.headers
      ? Object.entries(openTelemetry.headers).map(([key, value]) => ({
          key: key,
          value: value,
        }))
      : undefined;

    // const assert = assertions ? getAssertionNew(assertions) : [];

    const _newMonitor = await db
      .insert(monitor)
      .values({
        ...rest,
        periodicity: input.frequency,
        jobType: "dns",
        url: input.request.uri,
        workspaceId: workspaceId,
        regions: regions ? regions.join(",") : undefined,
        // assertions: assert.length > 0 ? serialize(assert) : undefined,
        timeout: input.timeout || 45000,
        otelEndpoint: openTelemetry?.endpoint,
        otelHeaders: otelHeadersEntries
          ? JSON.stringify(otelHeadersEntries)
          : undefined,
      })
      .returning()
      .get();

    const otelHeader = _newMonitor.otelHeaders
      ? z
          .array(
            z.object({
              key: z.string(),
              value: z.string(),
            }),
          )
          .parse(JSON.parse(_newMonitor.otelHeaders))
          // biome-ignore lint/performance/noAccumulatingSpread: <explanation>
          .reduce((a, v) => ({ ...a, [v.key]: v.value }), {})
      : undefined;

    const data = MonitorSchema.parse({
      ..._newMonitor,
      openTelemetry: _newMonitor.otelEndpoint
        ? {
            headers: otelHeader,
            endpoint: _newMonitor.otelEndpoint ?? undefined,
          }
        : undefined,
    });

    return c.json(data, 200);
  });
}
