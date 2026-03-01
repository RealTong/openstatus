import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type SQL, and, desc, eq, inArray, isNull, sql } from "@openstatus/db";
import {
  insertPageSchema,
  monitor,
  page,
  pageAccessTypes,
  pageComponent,
  selectMaintenanceSchema,
  selectPageComponentGroupSchema,
  selectPageComponentSchema,
  selectPageSchema,
  subdomainSafeList,
} from "@openstatus/db/src/schema";

import { createTRPCRouter, protectedProcedure } from "../trpc";

if (process.env.NODE_ENV === "test") {
  require("../test/preload");
}

// Helper functions to reuse Vercel API logic
async function addDomainToVercel(domain: string) {
  const data = await fetch(
    `https://api.vercel.com/v9/projects/${env.PROJECT_ID_VERCEL}/domains?teamId=${env.TEAM_ID_VERCEL}`,
    {
      body: JSON.stringify({ name: domain }),
      headers: {
        Authorization: `Bearer ${env.VERCEL_AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  return data.json();
}

async function removeDomainFromVercel(domain: string) {
  const data = await fetch(
    `https://api.vercel.com/v9/projects/${env.PROJECT_ID_VERCEL}/domains/${domain}?teamId=${env.TEAM_ID_VERCEL}`,
    {
      headers: {
        Authorization: `Bearer ${env.VERCEL_AUTH_BEARER_TOKEN}`,
      },
      method: "DELETE",
    },
  );
  return data.json();
}

export const pageRouter = createTRPCRouter({
  create: protectedProcedure
    .input(insertPageSchema)
    .mutation(async (opts) => {
      const { monitors, workspaceId, id, configuration, ...pageProps } =
        opts.input;

      const monitorIds = monitors?.map((item) => item.monitorId) || [];

      const newPage = await opts.ctx.db
        .insert(page)
        .values({
          workspaceId: opts.ctx.workspace.id,
          configuration: JSON.stringify(configuration),
          ...pageProps,
          authEmailDomains: pageProps.authEmailDomains?.join(","),
        })
        .returning()
        .get();

      if (monitorIds.length) {
        const allMonitors = await opts.ctx.db.query.monitor.findMany({
          where: and(
            inArray(monitor.id, monitorIds),
            eq(monitor.workspaceId, opts.ctx.workspace.id),
            eq(monitor.active, true),
            isNull(monitor.deletedAt),
          ),
        });

        if (allMonitors.length !== monitorIds.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "You don't have access to all the monitors or some monitors are inactive.",
          });
        }

        const monitorMap = new Map(allMonitors.map((m) => [m.id, m]));

        const pageComponentValues = monitors
          .map(({ monitorId }, index) => {
            const m = monitorMap.get(monitorId);
            if (!m || !m.workspaceId) return null;
            return {
              workspaceId: m.workspaceId,
              pageId: newPage.id,
              type: "monitor" as const,
              monitorId,
              name: m.externalName || m.name,
              order: index,
              groupId: null,
              groupOrder: 0,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        await opts.ctx.db
          .insert(pageComponent)
          .values(pageComponentValues)
          .run();
      }

      return newPage;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.id, opts.input.id),
        eq(page.workspaceId, opts.ctx.workspace.id),
      ];

      await opts.ctx.db
        .delete(page)
        .where(and(...whereConditions))
        .run();
    }),

  getSlugUniqueness: protectedProcedure
    .input(z.object({ slug: z.string().toLowerCase() }))
    .query(async (opts) => {
      if (subdomainSafeList.includes(opts.input.slug)) {
        return false;
      }
      const result = await opts.ctx.db.query.page.findMany({
        where: sql`lower(${page.slug}) = ${opts.input.slug}`,
      });
      return !(result?.length > 0);
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          order: z.enum(["asc", "desc"]).optional(),
        })
        .optional(),
    )
    .query(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
      ];

      const result = await opts.ctx.db.query.page.findMany({
        where: and(...whereConditions),
        with: {
          statusReports: true,
        },
        orderBy: (pages, { asc }) => [
          opts.input?.order === "asc"
            ? asc(pages.createdAt)
            : desc(pages.createdAt),
        ],
      });

      return result;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      const data = await opts.ctx.db.query.page.findFirst({
        where: and(...whereConditions),
        with: {
          maintenances: true,
          pageComponents: true,
          pageComponentGroups: true,
        },
      });

      return selectPageSchema
        .extend({
          pageComponentGroups: z
            .array(selectPageComponentGroupSchema)
            .prefault([]),
          maintenances: z.array(selectMaintenanceSchema).prefault([]),
          pageComponents: z.array(selectPageComponentSchema).prefault([]),
        })
        .parse({
          ...data,
          pageComponentGroups: data?.pageComponentGroups ?? [],
          maintenances: data?.maintenances,
          pageComponents: data?.pageComponents,
        });
    }),

  new: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        slug: z.string().toLowerCase(),
        icon: z.string().nullish(),
        description: z.string().nullish(),
      }),
    )
    .mutation(async (opts) => {
      const result = await opts.ctx.db.query.page.findMany({
        where: sql`lower(${page.slug}) = ${opts.input.slug}`,
      });

      if (subdomainSafeList.includes(opts.input.slug) || result?.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This slug is already taken. Please choose another one.",
        });
      }

      const defaultConfiguration = {
        type: "absolute",
        value: "requests",
        uptime: true,
        theme: "default-rounded",
      } satisfies Record<string, string | boolean | undefined>;

      const newPage = await opts.ctx.db
        .insert(page)
        .values({
          workspaceId: opts.ctx.workspace.id,
          title: opts.input.title,
          slug: opts.input.slug,
          description: opts.input.description ?? "",
          icon: opts.input.icon ?? "",
          legacyPage: false,
          configuration: defaultConfiguration,
          customDomain: "",
        })
        .returning()
        .get();

      return newPage;
    }),

  updateGeneral: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string(),
        slug: z.string().toLowerCase(),
        description: z.string().nullish(),
        icon: z.string().nullish(),
      }),
    )
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      const result = await opts.ctx.db.query.page.findMany({
        where: sql`lower(${page.slug}) = ${opts.input.slug}`,
      });

      const oldSlug = await opts.ctx.db.query.page.findFirst({
        where: and(...whereConditions),
      });

      if (
        subdomainSafeList.includes(opts.input.slug) ||
        (oldSlug?.slug !== opts.input.slug && result?.length > 0)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This slug is already taken. Please choose another one.",
        });
      }

      await opts.ctx.db
        .update(page)
        .set({
          title: opts.input.title,
          slug: opts.input.slug,
          description: opts.input.description ?? "",
          icon: opts.input.icon ?? "",
          updatedAt: new Date(),
        })
        .where(and(...whereConditions))
        .run();
    }),

  updateCustomDomain: protectedProcedure
    .input(z.object({ id: z.number(), customDomain: z.string().toLowerCase() }))
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      if (opts.input.customDomain.includes("openstatus")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Domain cannot contain 'openstatus'",
        });
      }

      // Get the current page to check the existing custom domain
      const currentPage = await opts.ctx.db.query.page.findFirst({
        where: and(...whereConditions),
      });

      if (!currentPage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      const oldDomain = currentPage.customDomain;
      const newDomain = opts.input.customDomain;

      await opts.ctx.db
        .update(page)
        .set({ customDomain: newDomain, updatedAt: new Date() })
        .where(and(...whereConditions))
        .run();
    }),

  updatePasswordProtection: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        accessType: z.enum(pageAccessTypes),
        authEmailDomains: z.array(z.string()).nullish(),
        password: z.string().nullish(),
      }),
    )
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      await opts.ctx.db
        .update(page)
        .set({
          accessType: opts.input.accessType,
          authEmailDomains: opts.input.authEmailDomains?.join(","),
          password: opts.input.password,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions))
        .run();
    }),

  updateAppearance: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        forceTheme: z.enum(["light", "dark", "system"]),
        configuration: z.object({
          theme: z.string(),
        }),
      }),
    )
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      const _page = await opts.ctx.db.query.page.findFirst({
        where: and(...whereConditions),
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      const currentConfiguration =
        (typeof _page.configuration === "object" &&
          _page.configuration !== null &&
          _page.configuration) ||
        {};
      const updatedConfiguration = {
        ...currentConfiguration,
        theme: opts.input.configuration.theme,
      };

      await opts.ctx.db
        .update(page)
        .set({
          forceTheme: opts.input.forceTheme,
          configuration: updatedConfiguration,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions))
        .run();
    }),

  updateLinks: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        homepageUrl: z.string().nullish(),
        contactUrl: z.string().nullish(),
      }),
    )
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      await opts.ctx.db
        .update(page)
        .set({
          homepageUrl: opts.input.homepageUrl,
          contactUrl: opts.input.contactUrl,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions))
        .run();
    }),

  updatePageConfiguration: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        configuration: z
          .record(z.string(), z.string().or(z.boolean()).optional())
          .nullish(),
      }),
    )
    .mutation(async (opts) => {
      const whereConditions: SQL[] = [
        eq(page.workspaceId, opts.ctx.workspace.id),
        eq(page.id, opts.input.id),
      ];

      const _page = await opts.ctx.db.query.page.findFirst({
        where: and(...whereConditions),
      });

      if (!_page) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Page not found",
        });
      }

      const currentConfiguration =
        (typeof _page.configuration === "object" &&
          _page.configuration !== null &&
          _page.configuration) ||
        {};
      const updatedConfiguration = {
        ...currentConfiguration,
        ...opts.input.configuration,
      };

      await opts.ctx.db
        .update(page)
        .set({
          configuration: updatedConfiguration,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions))
        .run();
    }),
});
