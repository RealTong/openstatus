import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";

export const GitHubProvider = GitHub({
  allowDangerousEmailAccountLinking: true,
});

export const GoogleProvider = Google({
  allowDangerousEmailAccountLinking: true,
  authorization: {
    params: {
      // See https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
      prompt: "select_account",
    },
  },
});

export const ResendProvider = Resend({
  apiKey: undefined, // REMINDER: keep undefined to avoid sending emails
  async sendVerificationRequest(params) {
    console.log("");
    console.log(`>>> Magic Link: ${params.url}`);
    console.log("");
  },
});

/**
 * Custom OIDC provider — enabled when OIDC_ISSUER env var is set.
 * Supports any OpenID Connect compatible identity provider
 * (e.g. Authentik, Keycloak, PocketID, Dex, etc.)
 */
export function getOIDCProvider(): Provider | null {
  if (!process.env.OIDC_ISSUER) return null;

  // Use the generic OIDC provider from next-auth
  // https://authjs.dev/getting-started/providers/oidc
  return {
    id: "custom-oidc",
    name: process.env.OIDC_DISPLAY_NAME || "SSO",
    type: "oidc",
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    allowDangerousEmailAccountLinking: true,
  };
}
