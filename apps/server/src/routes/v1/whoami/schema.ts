import { z } from "@hono/zod-openapi";

export const WorkspaceSchema = z
  .object({
    name: z
      .string()
      .optional()
      .openapi({ description: "The current workspace name" }),
    slug: z.string().openapi({ description: "The current workspace slug" }),
  })
  .openapi("Workspace");

export type WorkspaceSchema = z.infer<typeof WorkspaceSchema>;
