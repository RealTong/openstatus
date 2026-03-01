import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";

import { db, eq } from "@openstatus/db";
import { user } from "@openstatus/db/src/schema";

import { WelcomeEmail, sendEmail } from "@openstatus/emails";
import { adapter } from "./adapter";
import {
  GitHubProvider,
  GoogleProvider,
  ResendProvider,
  getOIDCProvider,
} from "./providers";

export type { DefaultSession };

function buildProviders() {
  const providers =
    process.env.NODE_ENV === "development" || process.env.SELF_HOST === "true"
      ? [GitHubProvider, GoogleProvider, ResendProvider]
      : [GitHubProvider, GoogleProvider];

  const oidc = getOIDCProvider();
  if (oidc) providers.push(oidc);

  return providers;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  adapter,
  providers: buildProviders(),
  callbacks: {
    async signIn(params) {
      // We keep updating the user info when we loggin in

      if (params.account?.provider === "google") {
        if (!params.profile) return true;
        if (Number.isNaN(Number(params.user.id))) return true;

        await db
          .update(user)
          .set({
            firstName: params.profile.given_name,
            lastName: params.profile.family_name || "",
            photoUrl: params.profile.picture,
            // keep the name in sync
            name: `${params.profile.given_name} ${
              params.profile.family_name || ""
            }`.trim(),
            updatedAt: new Date(),
          })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }
      if (params.account?.provider === "github") {
        if (!params.profile) return true;
        if (Number.isNaN(Number(params.user.id))) return true;

        await db
          .update(user)
          .set({
            name: params.profile.name,
            photoUrl: String(params.profile.avatar_url),
            updatedAt: new Date(),
          })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }

      // REMINDER: only used in dev mode
      if (params.account?.provider === "resend") {
        if (Number.isNaN(Number(params.user.id))) return true;
        await db
          .update(user)
          .set({ updatedAt: new Date() })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }

      // OIDC provider — sync profile data
      if (params.account?.provider === "custom-oidc") {
        if (!params.profile) return true;
        if (Number.isNaN(Number(params.user.id))) return true;

        await db
          .update(user)
          .set({
            name: params.profile.name ?? params.user.name,
            photoUrl: (params.profile.picture as string) ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }

      return true;
    },
    async session(params) {
      return params.session;
    },
  },
  events: {
    // That should probably done in the callback method instead
    async createUser(params) {
      if (!params.user.id || !params.user.email) {
        throw new Error("User id & email is required");
      }

      // this means the user has already been created with clerk
      if (params.user.tenantId) return;

      await sendEmail({
        from: "OpenStatus <noreply@openstatus.dev>",
        subject: "Welcome to OpenStatus.",
        to: [params.user.email],
        react: WelcomeEmail(),
      });
    },
  },
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  // basePath: "/api/auth", // default is `/api/auth`
  // secret: process.env.AUTH_SECRET, // default is `AUTH_SECRET`
  debug: process.env.NODE_ENV === "development",
});
