import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { workspaceRole } from "./constants";
import { workspace } from "./workspace";

export const workspaceRoleSchema = z.enum(workspaceRole);

export const selectWorkspaceSchema = createSelectSchema(workspace);

export const insertWorkspaceSchema = createSelectSchema(workspace);

export type Workspace = z.infer<typeof selectWorkspaceSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
