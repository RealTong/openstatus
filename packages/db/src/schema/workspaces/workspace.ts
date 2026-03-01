import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { monitor } from "../monitors";
import { notification } from "../notifications";
import { page } from "../pages";
import { usersToWorkspaces } from "../users";

export const workspace = sqliteTable("workspace", {
  id: integer("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const workspaceRelations = relations(workspace, ({ many }) => ({
  usersToWorkspaces: many(usersToWorkspaces),
  pages: many(page),
  monitors: many(monitor),
  notifications: many(notification),
}));
