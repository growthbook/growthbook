import useSWR from "swr";
import { useCallback } from "react";
import { useAuth } from "@/services/auth";

export default function useApi<Response = unknown>(path: string | null) {
  const { apiCall, orgId } = useAuth();

  // Scope the api request to the current organization
  const key = path === null ? null : orgId + "::" + path;

  const fetcher = useCallback(
    async (key: string) => {
      const path = key ? key.split("::", 2)[1] : null;
      return apiCall<Response>(path || null, {
        method: "GET",
      });
    },
    [apiCall]
  );

  return useSWR<Response, Error>(key, fetcher);
}
