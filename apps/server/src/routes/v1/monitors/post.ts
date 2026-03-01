import { createRoute, z } from "@hono/zod-openapi";

import { and, db, eq, isNull, sql } from "@openstatus/db";
import { monitor } from "@openstatus/db/src/schema";

import { serialize } from "@openstatus/assertions";

import { OpenStatusApiError, openApiErrorResponses } from "@/libs/errors";
import type { monitorsApi } from "./index";
import { MonitorSchema } from "./schema";
import { getAssertions } from "./utils";

const postRoute = createRoute({
  method: "post",
  tags: ["monitor"],
  summary: "Create a monitor",
  path: "/",
  request: {
    body: {
      description: "The monitor to create",
      content: {
        "application/json": {
          schema: MonitorSchema.omit({ id: true }),
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

export function registerPostMonitor(api: typeof monitorsApi) {
  return api.openapi(postRoute, async (c) => {
    const workspaceId = c.get("workspace").id;
    const input = c.req.valid("json");

    if (input.jobType && !["http", "tcp"].includes(input.jobType)) {
      throw new OpenStatusApiError({
        code: "BAD_REQUEST",
        message:
          "Invalid jobType, currently only 'http' and 'tcp' are supported",
      });
    }

    const { headers, regions, assertions, ...rest } = input;

    const assert = assertions ? getAssertions(assertions) : [];

    const _newMonitor = await db
      .insert(monitor)
      .values({
        ...rest,
        workspaceId: workspaceId,
        regions: regions ? regions.join(",") : undefined,
        description: input.description ?? undefined,
        headers: input.headers ? JSON.stringify(input.headers) : undefined,
        assertions: assert.length > 0 ? serialize(assert) : undefined,
        timeout: input.timeout || 45000,
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
