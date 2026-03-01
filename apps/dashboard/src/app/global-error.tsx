"use client";

import NextError from "next/error";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body>
        {/* This is the default Next.js error component but it doesn't allow omitting the statusCode property yet. */}
        {/* biome-ignore lint/suspicious/noExplicitAny: <explanation> */}
        <NextError statusCode={undefined as any} />
      </body>
    </html>
  );
}
