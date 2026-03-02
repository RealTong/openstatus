import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    RESEND_API_KEY: z.string(),
    CRON_SECRET: z.string(),
    // Vercel domain management (optional, not used in self-hosted)
    PROJECT_ID_VERCEL: z.string().optional(),
    TEAM_ID_VERCEL: z.string().optional(),
    VERCEL_AUTH_BEARER_TOKEN: z.string().optional(),
  },

  runtimeEnv: {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    PROJECT_ID_VERCEL: process.env.PROJECT_ID_VERCEL,
    TEAM_ID_VERCEL: process.env.TEAM_ID_VERCEL,
    VERCEL_AUTH_BEARER_TOKEN: process.env.VERCEL_AUTH_BEARER_TOKEN,
  },
  skipValidation: process.env.NODE_ENV === "test",
});
