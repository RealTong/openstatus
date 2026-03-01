"use client";

import { NavBreadcrumb } from "@/components/nav/nav-breadcrumb";
import { Blocks, Cog, User } from "lucide-react";

export function Breadcrumb() {
  return (
    <NavBreadcrumb
      items={[
        { type: "page", label: "Settings", icon: Cog },
        {
          type: "select",
          items: [
            { value: "general", label: "General", icon: Cog },
            { value: "account", label: "Account", icon: User },
            { value: "integrations", label: "Integrations", icon: Blocks },
          ],
        },
      ]}
    />
  );
}
