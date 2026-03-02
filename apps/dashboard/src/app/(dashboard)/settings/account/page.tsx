"use client";

import {
  Section,
  SectionGroup,
  SectionHeader,
  SectionTitle,
} from "@/components/content/section";
import {
  FormCardDescription,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";
import {
  FormCard,
  FormCardContent,
  FormCardFooter,
} from "@/components/forms/form-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTRPC } from "@/lib/trpc/client";
import { Button } from "@openstatus/ui/components/ui/button";
import { Input } from "@openstatus/ui/components/ui/input";
import { Label } from "@openstatus/ui/components/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

export default function Page() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: user } = useQuery(trpc.user.get.queryOptions());
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const updateUserMutation = useMutation(
    trpc.user.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.user.get.queryKey() });
      },
    }),
  );

  useEffect(() => {
    if (!user) return;
    const fallbackName =
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    setName(user.name ?? fallbackName);
  }, [user]);

  if (!user) return null;

  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPending) return;
    const value = name.trim();
    if (!value) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const promise = updateUserMutation.mutateAsync({
          name: value,
        });
        toast.promise(promise, {
          loading: "Saving...",
          success: "Saved",
          error: "Failed to save",
        });
        await promise;
      } catch (error) {
        console.error(error);
      }
    });
  }

  return (
    <SectionGroup>
      <Section>
        <SectionHeader>
          <SectionTitle>Account</SectionTitle>
        </SectionHeader>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>Personal Information</FormCardTitle>
            <FormCardDescription>
              Manage your personal information.
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent>
            <form
              className="grid gap-4"
              onSubmit={submitAction}
              id="account-form"
            >
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input
                  value={user?.email ?? ""}
                  readOnly
                  disabled
                  aria-readonly="true"
                />
              </div>
            </form>
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              Email updates are not supported from this page.
            </FormCardFooterInfo>
            <Button
              type="submit"
              form="account-form"
              size="sm"
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Submitting..." : "Submit"}
            </Button>
          </FormCardFooter>
        </FormCard>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>Appearance</FormCardTitle>
            <FormCardDescription>
              Choose your preferred theme.
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="pb-4">
            <ThemeToggle />
          </FormCardContent>
        </FormCard>
      </Section>
    </SectionGroup>
  );
}
