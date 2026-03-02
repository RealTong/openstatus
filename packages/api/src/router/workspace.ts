import { z } from "zod";

import { type SQL, and, eq, isNull } from "@openstatus/db";
import {
  monitor,
  usersToWorkspaces,
  workspace,
} from "@openstatus/db/src/schema";

import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Self-hosted plan limits — all unlimited (no SaaS restrictions).
 * Using Number.POSITIVE_INFINITY so limit checks always pass.
 */
const SELF_HOST_LIMITS: Record<string, number> = {
  monitors: Number.POSITIVE_INFINITY,
  notifications: Number.POSITIVE_INFINITY,
  pages: Number.POSITIVE_INFINITY,
  "status-subscribers": Number.POSITIVE_INFINITY,
  maintenanceWindows: Number.POSITIVE_INFINITY,
  incidents: Number.POSITIVE_INFINITY,
};

export const workspaceRouter = createTRPCRouter({
  getWorkspace: protectedProcedure.query(async (opts) => {
    const result = await opts.ctx.db.query.workspace.findFirst({
      where: eq(workspace.id, opts.ctx.workspace.id),
    });
    if (!result) return null;
    return { ...result, limits: SELF_HOST_LIMITS };
  }),

  get: protectedProcedure.query(async (opts) => {
    const whereConditions: SQL[] = [eq(workspace.id, opts.ctx.workspace.id)];

    const result = await opts.ctx.db.query.workspace.findFirst({
      where: and(...whereConditions),
      with: {
        pages: {
          with: {
            pageComponents: true,
          },
        },
        monitors: {
          where: isNull(monitor.deletedAt),
        },
        notifications: true,
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      slug: result.slug,
      name: result.name,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      usage: {
        monitors: result.monitors?.length ?? 0,
        notifications: result.notifications?.length ?? 0,
        pages: result.pages?.length ?? 0,
        pageComponents:
          result.pages?.flatMap((page) => page.pageComponents)?.length ?? 0,
        checks: 0,
      },
      limits: SELF_HOST_LIMITS,
    };
  }),

  list: protectedProcedure.query(async (opts) => {
    const result = await opts.ctx.db.query.usersToWorkspaces.findMany({
      where: eq(usersToWorkspaces.userId, opts.ctx.user.id),
      with: {
        workspace: true,
      },
    });

    return result.map(({ workspace: ws }) => ws);
  }),

  updateName: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [eq(workspace.id, opts.ctx.workspace.id)];

      await opts.ctx.db
        .update(workspace)
        .set({ name: opts.input.name, updatedAt: new Date() })
        .where(and(...whereConditions));
    }),
});
