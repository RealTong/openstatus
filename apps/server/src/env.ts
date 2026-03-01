import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    CRON_SECRET: z.string(),
    SCREENSHOT_SERVICE_URL: z.string(),
    NODE_ENV: z.string().prefault("development"),
    SUPER_ADMIN_TOKEN: z.string(),
    RESEND_API_KEY: z.string(),
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    SLACK_REDIRECT_URI: z.string().optional(),
  },

  runtimeEnv: process.env,

  skipValidation: true,
});
