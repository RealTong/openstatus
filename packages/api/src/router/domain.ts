import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export type DomainVerificationStatusProps =
  | "Valid Configuration"
  | "Domain Not Found"
  | "Pending Verification"
  | "Invalid Configuration"
  | "Unknown Error";

const verificationRecordSchema = z.object({
  type: z.string(),
  domain: z.string(),
  value: z.string(),
  reason: z.string().optional(),
});

const domainResponseSchema = z.object({
  name: z.string(),
  apexName: z.string(),
  verified: z.boolean(),
  verification: z.array(verificationRecordSchema).default([]),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

const configResponseSchema = z.object({
  misconfigured: z.boolean(),
});

const verifyResponseSchema = z.object({
  verified: z.boolean(),
});

function normalizeDomain(input?: string) {
  if (!input) return "";
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function isValidDomain(domain: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain);
}

function getApexDomain(domain: string) {
  const parts = domain.split(".");
  if (parts.length < 2) return domain;
  return parts.slice(-2).join(".");
}

export const domainRouter = createTRPCRouter({
  getDomainResponse: protectedProcedure
    .input(
      z.object({
        domain: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const domain = normalizeDomain(input.domain);

      if (!domain || !isValidDomain(domain)) {
        return domainResponseSchema.parse({
          name: domain,
          apexName: domain,
          verified: false,
          verification: [],
          error: {
            code: "invalid_domain",
            message: "Please enter a valid domain.",
          },
        });
      }

      // Self-hosted mode: we don't have Vercel domain APIs, so return a
      // lightweight response that keeps the UI functional.
      return domainResponseSchema.parse({
        name: domain,
        apexName: getApexDomain(domain),
        verified: true,
        verification: [],
      });
    }),

  getConfigResponse: protectedProcedure
    .input(
      z.object({
        domain: z.string().optional(),
      }),
    )
    .query(() => {
      return configResponseSchema.parse({
        misconfigured: false,
      });
    }),

  verifyDomain: protectedProcedure
    .input(
      z.object({
        domain: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const domain = normalizeDomain(input.domain);
      return verifyResponseSchema.parse({
        verified: !!domain && isValidDomain(domain),
      });
    }),
});
