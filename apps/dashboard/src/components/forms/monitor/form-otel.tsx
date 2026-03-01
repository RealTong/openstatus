"use client";

import { Link } from "@/components/common/link";
import {
  FormCard,
  FormCardContent,
  FormCardDescription,
  FormCardFooter,
  FormCardFooterInfo,
  FormCardHeader,
  FormCardTitle,
} from "@/components/forms/form-card";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@openstatus/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@openstatus/ui/components/ui/form";
import { Input } from "@openstatus/ui/components/ui/input";
import { Plus, X } from "lucide-react";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// TODO: add headers

const schema = z.object({
  endpoint: z.url("Please enter a valid URL"),
  headers: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .prefault([]),
});

type FormValues = z.input<typeof schema>;

export function FormOtel({
  defaultValues,
  onSubmit,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  defaultValues?: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? { endpoint: "", headers: [] },
  });
  const [isPending, startTransition] = useTransition();

  function submitAction(values: FormValues) {
    if (isPending) return;

    startTransition(async () => {
      try {
        const promise = onSubmit(values);
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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitAction)} {...props}>
        <FormCard>
          <FormCardHeader>
            <FormCardTitle>OpenTelemetry</FormCardTitle>
            <FormCardDescription>
              Configure your OpenTelemetry Exporter.
            </FormCardDescription>
          </FormCardHeader>
          <FormCardContent className="grid grid-cols-4 gap-4">
            <FormField
              control={form.control}
              name="endpoint"
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>Endpoint</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://otel.openstatus.dev/api/v1/metrics"

                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="headers"
              render={({ field }) => (
                <FormItem className="col-span-full">
                  <FormLabel>Request Headers</FormLabel>
                  {field.value?.map((header, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-5">
                      <Input
                        placeholder="Key"
                        className="col-span-2"
                        value={header.key}
  
                        onChange={(e) => {
                          const newHeaders = [...(field.value ?? [])];
                          newHeaders[index] = {
                            ...newHeaders[index],
                            key: e.target.value,
                          };
                          field.onChange(newHeaders);
                        }}
                      />
                      <Input
                        placeholder="Value"
                        className="col-span-2"
                        value={header.value}
  
                        onChange={(e) => {
                          const newHeaders = [...(field.value ?? [])];
                          newHeaders[index] = {
                            ...newHeaders[index],
                            value: e.target.value,
                          };
                          field.onChange(newHeaders);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          const newHeaders = field.value?.filter(
                            (_, i) => i !== index,
                          );
                          field.onChange(newHeaders);
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"

                      onClick={() => {
                        field.onChange([
                          ...(field.value ?? []),
                          { key: "", value: "" },
                        ]);
                      }}
                    >
                      <Plus />
                      Add Header
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormCardContent>
          <FormCardFooter>
            <FormCardFooterInfo>
              Learn more about{" "}
              <Link
                href="https://docs.openstatus.dev/reference/http-monitor/#opentelemetry"
                rel="noreferrer"
                target="_blank"
              >
                OTel
              </Link>
              .
            </FormCardFooterInfo>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Submitting..." : "Submit"}
            </Button>
          </FormCardFooter>
        </FormCard>
      </form>
    </Form>
  );
}
