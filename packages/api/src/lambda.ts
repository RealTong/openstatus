import { apiKeyRouter } from "./router/apiKey";
import { emailRouter } from "./router/email";
import { integrationRouter } from "./router/integration";
import { createTRPCRouter } from "./trpc";
// Deployed to /trpc/lambda/**
export const lambdaRouter = createTRPCRouter({
  emailRouter: emailRouter,
  apiKeyRouter: apiKeyRouter,
  integrationRouter: integrationRouter,
});
