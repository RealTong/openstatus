"use client";

import {
  EmptyStateContainer,
  EmptyStateDescription,
  EmptyStateTitle,
} from "@/components/content/empty-state";
import {
  SectionDescription,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";

import { Section } from "@/components/content/section";
import { columns } from "@/components/data-table/subscribers/columns";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data: page } = useQuery(
    trpc.page.get.queryOptions({ id: Number.parseInt(id) }),
  );
  const { data: subscribers } = useQuery(
    trpc.pageSubscriber.list.queryOptions({ pageId: Number.parseInt(id) }),
  );

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>{page?.title}</SectionTitle>
          <SectionDescription>List of all subscribers.</SectionDescription>
        </SectionHeader>
      </Section>
      <Section>
        {subscribers?.length ? (
          <DataTable columns={columns} data={subscribers} />
        ) : (
          <EmptyStateContainer>
            <EmptyStateTitle>No subscribers</EmptyStateTitle>
            <EmptyStateDescription>
              No emails have been subscribed to this status page.
            </EmptyStateDescription>
          </EmptyStateContainer>
        )}
      </Section>
    </SectionGroup>
  );
}
