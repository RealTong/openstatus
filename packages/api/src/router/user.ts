import { eq } from "@openstatus/db";
import { user } from "@openstatus/db/src/schema";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
  get: protectedProcedure.query(async (opts) => {
    return await opts.ctx.db
      .select()
      .from(user)
      .where(eq(user.id, opts.ctx.user.id))
      .get();
  }),
  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
      }),
    )
    .mutation(async (opts) => {
      return await opts.ctx.db
        .update(user)
        .set({
          name: opts.input.name,
          updatedAt: new Date(),
        })
        .where(eq(user.id, opts.ctx.user.id))
        .returning()
        .get();
    }),
});
