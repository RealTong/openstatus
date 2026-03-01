"use client";
import {
  Section,
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import { columns } from "@/components/data-table/private-locations/columns";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";

export function Client() {
  const trpc = useTRPC();
  const { data: privateLocations } = useQuery(
    trpc.privateLocation.list.queryOptions(),
  );

  if (!privateLocations) return null;

  return (
    <SectionGroup>
      <SectionHeader>
        <SectionTitle>Private Locations</SectionTitle>
        <SectionDescription>
          Create and manage your private locations.
        </SectionDescription>
      </SectionHeader>
      <Section>
        <DataTable columns={columns} data={privateLocations} />
      </Section>
    </SectionGroup>
  );
}
