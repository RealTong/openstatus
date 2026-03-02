"use client";

import {
  DataTableSheet,
  DataTableSheetContent,
  DataTableSheetHeader,
  DataTableSheetTitle,
} from "@/components/data-table/data-table-sheet";
import type { ResponseLogEntry } from "@openstatus/api/src/router/monitorData";
import type { RouterOutputs } from "@openstatus/api";
import { DataTableBasics } from "./data-table-basics";

type TestTCP = RouterOutputs["checker"]["testTcp"];
type TestHTTP = RouterOutputs["checker"]["testHttp"];
type TestDNS = RouterOutputs["checker"]["testDns"];
type Monitor = NonNullable<RouterOutputs["monitor"]["get"]>;

export function DataTableSheetTest({
  data,
  monitor,
  onClose,
}: {
  data: TestTCP | TestHTTP | TestDNS | null;
  monitor: Monitor;
  onClose: () => void;
}) {
  if (!data) return null;

  const _data = mapping(data, monitor);

  if (!_data) return null;

  return (
    <DataTableSheet defaultOpen>
      {/* NOTE: we are using onCloseAutoFocus to reset with a delay to avoid abrupt closing of the sheet */}
      <DataTableSheetContent className="sm:max-w-lg" onCloseAutoFocus={onClose}>
        <DataTableSheetHeader className="px-2">
          <DataTableSheetTitle>Test Result</DataTableSheetTitle>
        </DataTableSheetHeader>
        <DataTableBasics data={_data} />
      </DataTableSheetContent>
    </DataTableSheet>
  );
}

function mapping(
  data: TestTCP | TestHTTP | TestDNS,
  monitor: Monitor,
): ResponseLogEntry | null {
  const base = {
    id: "",
    trigger: "cron" as const,
    workspaceId: String(monitor.workspaceId),
    monitorId: String(monitor.id),
    error: false,
    message: null,
    body: null,
    uri: null,
    errorMessage: null,
    records: null,
    requestStatus: "success" as const,
    statusCode: 0,
    url: monitor.url ?? "",
    method: "",
    headers: {} as Record<string, string>,
    assertions: [] as unknown[],
    timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, transfer: 0 },
  };

  switch (data.type) {
    case "http":
      return {
        ...base,
        type: "http",
        timestamp: data.timestamp,
        cronTimestamp: data.timestamp,
        region: data.region,
        latency: data.latency,
        statusCode: data.status,
        headers: data.headers as Record<string, string>,
        timing: {
          dns: data.timing.dnsDone - data.timing.dnsStart,
          connect: data.timing.connectDone - data.timing.connectStart,
          tls: data.timing.tlsHandshakeDone - data.timing.tlsHandshakeStart,
          ttfb: data.timing.firstByteDone - data.timing.firstByteStart,
          transfer: data.timing.transferDone - data.timing.transferStart,
        },
        assertions: monitor.assertions ?? [],
        body: data.body ?? null,
      };
    case "tcp":
      return {
        ...base,
        type: "tcp",
        timestamp: data.timestamp,
        cronTimestamp: data.timestamp,
        region: data.region,
        latency: data.latency ?? 0,
        uri: monitor.url ?? null,
        errorMessage: null,
      };
    case "dns":
      return {
        ...base,
        type: "dns",
        timestamp: data.timestamp,
        cronTimestamp: data.timestamp,
        region: data.region,
        latency: data.latency ?? 0,
        uri: monitor.url ?? null,
        records: (data.records as Record<string, string | string[]>) ?? null,
      };
    default:
      return null;
  }
}
