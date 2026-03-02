const DEFAULT_STATUS_PAGE_DOMAIN = "openstatus.dev";
const DEFAULT_DEV_STATUS_PAGE_URL = "http://localhost:3000";

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeDomain(domain?: string | null) {
  if (!domain) return "";
  return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function getStatusPageSlugSuffix() {
  const domain = normalizeDomain(process.env.NEXT_PUBLIC_STATUS_PAGE_DOMAIN);
  return `.${domain || DEFAULT_STATUS_PAGE_DOMAIN}`;
}

export function getStatusPageUrl({
  slug,
  customDomain,
  path = "",
}: {
  slug: string;
  customDomain?: string | null;
  path?: string;
}) {
  const normalizedPath =
    path.startsWith("/") || path.length === 0 ? path : `/${path}`;
  const normalizedCustomDomain = normalizeDomain(customDomain);

  if (normalizedCustomDomain) {
    return `https://${normalizedCustomDomain}${normalizedPath}`;
  }

  const baseUrl = process.env.NEXT_PUBLIC_STATUS_PAGE_BASE_URL;
  if (baseUrl) {
    return `${trimSlash(baseUrl)}/${slug}${normalizedPath}`;
  }

  if (process.env.NODE_ENV === "development") {
    const devBase = trimSlash(
      process.env.NEXT_PUBLIC_STATUS_PAGE_DEV_URL ||
        DEFAULT_DEV_STATUS_PAGE_URL,
    );
    return `${devBase}/${slug}${normalizedPath}`;
  }

  const rootDomain =
    normalizeDomain(process.env.NEXT_PUBLIC_STATUS_PAGE_DOMAIN) ||
    DEFAULT_STATUS_PAGE_DOMAIN;
  return `https://${slug}.${rootDomain}${normalizedPath}`;
}
