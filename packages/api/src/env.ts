import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    RESEND_API_KEY: z.string(),
    CRON_SECRET: z.string(),
  },

  runtimeEnv: {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
  },
  skipValidation: process.env.NODE_ENV === "test",
});
