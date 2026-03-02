import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Stub blob router for self-hosted deployments.
 * The original SaaS blob upload (Vercel Blob) has been removed.
 * Returns empty URLs — status page logo upload is not supported in self-hosted.
 */
export const blobRouter = createTRPCRouter({
  upload: protectedProcedure
    .input(
      z.object({ filename: z.string(), file: z.string() }).optional(),
    )
    .mutation(async () => {
      return { url: "" };
    }),
});
