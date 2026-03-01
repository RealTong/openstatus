import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { monitorResult } from "./monitor_result";

export const selectMonitorResultSchema = createSelectSchema(monitorResult);
export const insertMonitorResultSchema = createInsertSchema(monitorResult);

export type MonitorResult = z.infer<typeof selectMonitorResultSchema>;
export type InsertMonitorResult = z.infer<typeof insertMonitorResultSchema>;
