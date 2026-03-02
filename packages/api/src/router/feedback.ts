import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Stub feedback router for self-hosted deployments.
 * The original SaaS feedback feature has been removed; this stub
 * prevents TypeScript build errors in the onboarding page.
 */
export const feedbackRouter = createTRPCRouter({
  // biome-ignore lint/suspicious/noExplicitAny: stub router accepts any input shape
  submit: protectedProcedure.input(z.any()).mutation(async () => {
    // No-op in self-hosted mode
  }),
});
