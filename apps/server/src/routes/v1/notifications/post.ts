import { createRoute } from "@hono/zod-openapi";

import { OpenStatusApiError, openApiErrorResponses } from "@/libs/errors";
import { and, db, eq, inArray, isNull, sql } from "@openstatus/db";
import {
  NotificationDataSchema,
  monitor,
  notification,
  notificationsToMonitors,
  selectNotificationSchema,
} from "@openstatus/db/src/schema";
import type { notificationsApi } from "./index";
import { NotificationSchema } from "./schema";

const postRoute = createRoute({
  method: "post",
  tags: ["notification"],
  summary: "Create a notification",
  path: "/",
  request: {
    body: {
      description: "The notification to create",
      content: {
        "application/json": {
          schema: NotificationSchema.omit({ id: true }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: NotificationSchema,
        },
      },
      description: "Return the created notification",
    },
    ...openApiErrorResponses,
  },
});

export function registerPostNotification(api: typeof notificationsApi) {
  return api.openapi(postRoute, async (c) => {
    const workspaceId = c.get("workspace").id;
    const input = c.req.valid("json");

    const { payload, monitors, ...rest } = input;

    if (monitors?.length) {
      const _monitors = await db
        .select()
        .from(monitor)
        .where(
          and(
            inArray(monitor.id, monitors),
            eq(monitor.workspaceId, workspaceId),
            isNull(monitor.deletedAt),
          ),
        )
        .all();

      if (_monitors.length !== monitors.length) {
        throw new OpenStatusApiError({
          code: "BAD_REQUEST",
          message: `Some of the monitors ${monitors.join(", ")} not found`,
        });
      }
    }

    const _notification = await db
      .insert(notification)
      .values({
        ...rest,
        workspaceId: workspaceId,
        data: JSON.stringify(payload),
      })
      .returning()
      .get();

    if (monitors?.length) {
      for (const monitorId of monitors) {
        await db
          .insert(notificationsToMonitors)
          .values({ notificationId: _notification.id, monitorId })
          .run();
      }
    }

    // FIXME: too complex
    const d = selectNotificationSchema.parse(_notification);

    const _payload = NotificationDataSchema.parse(JSON.parse(d.data));
    const data = NotificationSchema.parse({
      ..._notification,
      monitors,
      payload: _payload,
    });
    return c.json(data, 200);
  });
}
