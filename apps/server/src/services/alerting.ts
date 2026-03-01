/**
 * Alerting service — triggers notifications when monitor status changes.
 *
 * This replaces the notification triggering logic that was previously handled
 * by the deleted Workflows/Cron infrastructure and TinyBird.
 *
 * Flow:
 * 1. Private Location writes a monitor result to SQLite
 * 2. This service checks if the status changed compared to monitor_status table
 * 3. If changed, creates/resolves an incident and sends notifications
 */

import { and, eq, sql } from "@openstatus/db";
import { db } from "@openstatus/db";
import {
  incidentTable,
  monitor,
  monitorStatusTable,
  notification,
  notificationsToMonitors,
  selectMonitorSchema,
} from "@openstatus/db/src/schema";

import type { NotificationContext } from "@openstatus/notification-base";

// Dynamic imports for notification providers to avoid bundling all providers
const providerMap: Record<
  string,
  () => Promise<{
    sendAlert?: (ctx: NotificationContext) => Promise<void>;
    sendRecovery?: (ctx: NotificationContext) => Promise<void>;
    sendDegraded?: (ctx: NotificationContext) => Promise<void>;
  }>
> = {
  discord: () => import("@openstatus/notification-discord"),
  slack: () => import("@openstatus/notification-slack"),
  email: () => import("@openstatus/notification-email"),
  webhook: () => import("@openstatus/notification-webhook"),
  telegram: () => import("@openstatus/notification-telegram"),
  "google-chat": () => import("@openstatus/notification-google-chat"),
  "grafana-oncall": () => import("@openstatus/notification-grafana-oncall"),
  ntfy: () => import("@openstatus/notification-ntfy"),
  opsgenie: () => import("@openstatus/notification-opsgenie"),
};

/**
 * Checks if the monitor status changed and triggers notifications accordingly.
 *
 * @param monitorId - The monitor that was just checked
 * @param region - The region the check was from
 * @param newStatus - The new request status ("success" | "degraded" | "error")
 * @param statusCode - HTTP status code (optional)
 * @param message - Error message (optional)
 * @param latency - Response latency in ms (optional)
 */
export async function processStatusChange(params: {
  monitorId: number;
  workspaceId: number;
  region: string;
  newStatus: "success" | "degraded" | "error";
  statusCode?: number;
  message?: string;
  latency?: number;
  cronTimestamp?: number;
}) {
  const {
    monitorId,
    region,
    newStatus,
    statusCode,
    message,
    latency,
    cronTimestamp,
  } = params;

  // Get current status from monitor_status table
  const currentStatus = await db
    .select()
    .from(monitorStatusTable)
    .where(
      and(
        eq(monitorStatusTable.monitorId, monitorId),
        eq(monitorStatusTable.region, region),
      ),
    )
    .get();

  const prevStatus = currentStatus?.status ?? "active";
  const monitorStatus = newStatus === "success" ? "active" : newStatus;

  // Upsert monitor_status
  await db
    .insert(monitorStatusTable)
    .values({
      monitorId,
      region,
      status: monitorStatus,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [monitorStatusTable.monitorId, monitorStatusTable.region],
      set: {
        status: monitorStatus,
        updatedAt: new Date(),
      },
    });

  // Update the monitor's overall status based on the worst status across regions
  const allStatuses = await db
    .select({ status: monitorStatusTable.status })
    .from(monitorStatusTable)
    .where(eq(monitorStatusTable.monitorId, monitorId));

  const worstStatus = allStatuses.reduce(
    (worst, s) => {
      if (s.status === "error") return "error";
      if (s.status === "degraded" && worst !== "error") return "degraded";
      return worst;
    },
    "active" as "active" | "degraded" | "error",
  );

  await db
    .update(monitor)
    .set({ status: worstStatus })
    .where(eq(monitor.id, monitorId));

  // Check if status actually changed (for notification purposes)
  if (prevStatus === monitorStatus) return;

  // Fetch monitor details for notification context
  const monitorRow = await db.query.monitor.findFirst({
    where: eq(monitor.id, monitorId),
  });
  if (!monitorRow) return;

  const parsedMonitor = selectMonitorSchema.parse(monitorRow);

  // Handle incidents
  if (newStatus === "error") {
    // Create incident
    await db.insert(incidentTable).values({
      monitorId,
      workspaceId: params.workspaceId,
      title: `Monitor ${parsedMonitor.name} is down`,
      status: "investigating",
      startedAt: new Date(),
      autoResolved: false,
    });
  } else if (prevStatus === "error" && newStatus === "success") {
    // Auto-resolve open incidents
    await db
      .update(incidentTable)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        autoResolved: true,
      })
      .where(
        and(
          eq(incidentTable.monitorId, monitorId),
          sql`${incidentTable.status} != 'resolved'`,
        ),
      );
  }

  // Fetch notifications linked to this monitor
  const linkedNotifications = await db
    .select({
      notification,
    })
    .from(notificationsToMonitors)
    .innerJoin(
      notification,
      eq(notificationsToMonitors.notificationId, notification.id),
    )
    .where(eq(notificationsToMonitors.monitorId, monitorId));

  if (linkedNotifications.length === 0) return;

  // Get the latest incident for recovery context
  const latestIncident = await db.query.incidentTable.findFirst({
    where: eq(incidentTable.monitorId, monitorId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });

  // Send notifications
  for (const { notification: notif } of linkedNotifications) {
    const provider = providerMap[notif.provider];
    if (!provider) continue;

    try {
      const providerModule = await provider();

      const ctx: NotificationContext = {
        monitor: parsedMonitor,
        notification: notif,
        statusCode,
        message,
        cronTimestamp: cronTimestamp ?? Date.now(),
        regions: [region],
        latency,
        incident: latestIncident ?? undefined,
      };

      if (newStatus === "error" && providerModule.sendAlert) {
        await providerModule.sendAlert(ctx);
      } else if (newStatus === "degraded" && providerModule.sendDegraded) {
        await providerModule.sendDegraded(ctx);
      } else if (
        newStatus === "success" &&
        prevStatus !== "active" &&
        providerModule.sendRecovery
      ) {
        await providerModule.sendRecovery(ctx);
      }
    } catch (err) {
      console.error(
        `Failed to send ${notif.provider} notification for monitor ${monitorId}:`,
        err,
      );
    }
  }
}
