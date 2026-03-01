"use client";

import { NavFeedback } from "@/components/nav/nav-feedback";
import { Button } from "@openstatus/ui/components/ui/button";
import Link from "next/link";

export function NavActions() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <NavFeedback />
      <Button size="sm" asChild>
        <Link href="/status-pages/create">Create Status Page</Link>
      </Button>
    </div>
  );
}
