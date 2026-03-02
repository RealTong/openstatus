import { and, eq, isNull } from "@openstatus/db";
import { invitation } from "@openstatus/db/src/schema";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const invitationRouter = createTRPCRouter({
  /**
   * Get invitation details by token (public - before user is logged in).
   */
  get: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.invitation.findFirst({
        where: eq(invitation.token, input.token),
        with: {
          workspace: true,
        },
      });

      if (!row) {
        throw new Error("Invitation not found");
      }

      return {
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        workspace: {
          id: row.workspace.id,
          slug: row.workspace.slug,
          name: row.workspace.name,
        },
      };
    }),

  /**
   * List pending invitations for the current workspace.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.invitation.findMany({
      where: and(
        eq(invitation.workspaceId, ctx.workspace.id),
        isNull(invitation.acceptedAt),
      ),
    });
    return rows;
  }),

  /**
   * Accept an invitation.
   */
  accept: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.id) throw new Error("Not authenticated");

      const row = await ctx.db.query.invitation.findFirst({
        where: eq(invitation.id, input.id),
        with: { workspace: true },
      });

      if (!row) throw new Error("Invitation not found");
      if (row.acceptedAt) throw new Error("Invitation already accepted");
      if (row.expiresAt < new Date()) throw new Error("Invitation expired");

      await ctx.db
        .update(invitation)
        .set({ acceptedAt: new Date() })
        .where(eq(invitation.id, input.id));

      return { slug: row.workspace.slug };
    }),

  /**
   * Delete (revoke) a pending invitation.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(invitation)
        .where(
          and(
            eq(invitation.id, input.id),
            eq(invitation.workspaceId, ctx.workspace.id),
          ),
        );
    }),
});
