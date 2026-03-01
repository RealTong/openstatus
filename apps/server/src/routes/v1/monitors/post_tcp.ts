import { createRoute, z } from "@hono/zod-openapi";

import { and, db, eq, isNull, sql } from "@openstatus/db";
import { monitor } from "@openstatus/db/src/schema";

import { OpenStatusApiError, openApiErrorResponses } from "@/libs/errors";
import type { monitorsApi } from "./index";
import { MonitorSchema, TCPMonitorSchema } from "./schema";

const postRoute = createRoute({
  method: "post",
  tags: ["monitor"],
  summary: "Create a  tcp monitor",
  path: "/tcp",
  request: {
    body: {
      description: "The monitor to create",
      content: {
        "application/json": {
          schema: TCPMonitorSchema,
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

export function registerPostMonitorTCP(api: typeof monitorsApi) {
  return api.openapi(postRoute, async (c) => {
    const workspaceId = c.get("workspace").id;
    const input = c.req.valid("json");

    const { request, regions, openTelemetry, ...rest } = input;
    const otelHeadersEntries = openTelemetry?.headers
      ? Object.entries(openTelemetry.headers).map(([key, value]) => ({
          key: key,
          value: value,
        }))
      : undefined;

    const _newMonitor = await db
      .insert(monitor)
      .values({
        ...rest,
        jobType: "tcp",
        periodicity: input.frequency,
        url: `${request.host}:${request.port}`,
        workspaceId: workspaceId,
        regions: regions ? regions.join(",") : undefined,
        headers: undefined,
        assertions: undefined,
        timeout: input.timeout || 45000,
        otelHeaders: otelHeadersEntries
          ? JSON.stringify(otelHeadersEntries)
          : undefined,
        otelEndpoint: openTelemetry?.endpoint,
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
