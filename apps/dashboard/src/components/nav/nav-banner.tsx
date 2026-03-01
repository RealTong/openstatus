"use client";

import { useCookieState } from "@openstatus/ui/hooks/use-cookie-state";
import { NavBannerChecklist } from "./nav-banner-checklist";

const EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // in 7 days

export function NavBanner() {
  const [openChecklist, setOpenChecklist] = useCookieState<"true" | "false">(
    "sidebar_banner_checklist",
    "true",
    { expires: EXPIRES_IN },
  );

  if (openChecklist === "true") {
    return <NavBannerChecklist handleClose={() => setOpenChecklist("false")} />;
  }

  return null;
}
