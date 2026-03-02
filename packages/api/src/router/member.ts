import { and, eq } from "@openstatus/db";
import { user, usersToWorkspaces } from "@openstatus/db/src/schema";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const memberRouter = createTRPCRouter({
  /**
   * List all members of the current workspace.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.usersToWorkspaces.findMany({
      where: eq(usersToWorkspaces.workspaceId, ctx.workspace.id),
      with: {
        user: true,
      },
    });

    return rows.map((row) => ({
      role: row.role,
      createdAt: row.createdAt,
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        createdAt: row.user.createdAt,
      },
    }));
  }),

  /**
   * Remove a member from the current workspace.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Prevent removing yourself as owner
      if (input.id === ctx.user?.id) {
        throw new Error("Cannot remove yourself");
      }

      await ctx.db
        .delete(usersToWorkspaces)
        .where(
          and(
            eq(usersToWorkspaces.userId, input.id),
            eq(usersToWorkspaces.workspaceId, ctx.workspace.id),
          ),
        );
    }),
});
