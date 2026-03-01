import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { monitor } from "../monitors/monitor";
import { workspace } from "../workspaces/workspace";

export const requestStatus = ["success", "degraded", "error"] as const;
export const jobType = ["http", "tcp", "dns"] as const;
export const trigger = ["cron", "api", "manual"] as const;

export const monitorResult = sqliteTable(
  "monitor_result",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monitorId: integer("monitor_id")
      .notNull()
      .references(() => monitor.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    jobType: text("job_type", { enum: jobType }).notNull(),
    region: text("region").notNull(),

    // Result
    statusCode: integer("status_code"),
    latency: integer("latency").notNull(),
    requestStatus: text("request_status", { enum: requestStatus }).notNull(),
    message: text("message"),

    // HTTP timing phases (null for TCP/DNS)
    timingDns: integer("timing_dns"),
    timingConnection: integer("timing_connection"),
    timingTls: integer("timing_tls"),
    timingTtfb: integer("timing_ttfb"),
    timingTransfer: integer("timing_transfer"),

    // Metadata
    trigger: text("trigger", { enum: trigger }).default("cron"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    monitorTimeIdx: index("idx_monitor_result_monitor_time").on(
      t.monitorId,
      t.createdAt,
    ),
    workspaceTimeIdx: index("idx_monitor_result_workspace_time").on(
      t.workspaceId,
      t.createdAt,
    ),
  }),
);

export const monitorResultRelations = relations(monitorResult, ({ one }) => ({
  monitor: one(monitor, {
    fields: [monitorResult.monitorId],
    references: [monitor.id],
  }),
  workspace: one(workspace, {
    fields: [monitorResult.workspaceId],
    references: [workspace.id],
  }),
}));
