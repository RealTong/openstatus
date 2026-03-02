import type { DomainVerificationStatusProps } from "@openstatus/api/src/router/domain";

import { useTRPC } from "@/lib/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

export function useDomainStatus(domain?: string) {
  const trpc = useTRPC();
  const normalizedDomain = domain?.trim();
  const enabled = !!normalizedDomain;

  const {
    data: domainJson,
    refetch: refetchDomain,
    isLoading: isLoadingDomain,
    isRefetching: isRefetchingDomain,
  } = useQuery(
    trpc.domain.getDomainResponse.queryOptions(
      { domain: normalizedDomain },
      { enabled },
    ),
  );
  const {
    data: configJson,
    refetch: refetchConfig,
    isLoading: isLoadingConfig,
    isRefetching: isRefetchingConfig,
  } = useQuery(
    trpc.domain.getConfigResponse.queryOptions(
      { domain: normalizedDomain },
      { enabled },
    ),
  );
  const {
    data: verificationJson,
    refetch: refetchVerification,
    isLoading: isLoadingVerification,
    isRefetching: isRefetchingVerification,
  } = useQuery(
    trpc.domain.verifyDomain.queryOptions(
      { domain: normalizedDomain },
      { enabled: enabled && !domainJson?.verified },
    ),
  );

  const refreshAll = useCallback(() => {
    refetchDomain();
    refetchConfig();
    refetchVerification();
  }, [refetchDomain, refetchConfig, refetchVerification]);

  if (!enabled) {
    return {
      status: "Unknown Error" as DomainVerificationStatusProps,
      domainJson: undefined,
      refresh: refreshAll,
      isLoading: false,
    };
  }

  let status: DomainVerificationStatusProps = "Valid Configuration";

  if (domainJson?.error?.code === "not_found") {
    // domain not found on Vercel project
    status = "Domain Not Found";

    // unknown error
  } else if (domainJson?.error) {
    status = "Unknown Error";

    // if domain is not verified, we try to verify now
  } else if (!domainJson?.verified) {
    status = "Pending Verification";

    // domain was just verified
    if (verificationJson?.verified) {
      status = "Valid Configuration";
    }
  } else if (configJson?.misconfigured) {
    status = "Invalid Configuration";
  } else {
    status = "Valid Configuration";
  }

  return {
    status,
    domainJson,
    refresh: refreshAll,
    isLoading:
      isLoadingDomain ||
      isLoadingConfig ||
      isLoadingVerification ||
      isRefetchingDomain ||
      isRefetchingConfig ||
      isRefetchingVerification,
  };
}
