import useSWR, { SWRConfiguration } from "swr";
import type { z } from "zod";
import { useAuth } from "@/services/auth";

export interface UseApiOptions {
  autoRevalidate?: boolean;
  shouldRun?: () => boolean;
  orgScoped?: boolean;
  refreshInterval?: number;
}

export default function useApi<Response = unknown>(
  path: string,
  {
    shouldRun,
    autoRevalidate = true,
    orgScoped = true,
    refreshInterval,
  }: UseApiOptions = {},
) {
  const { apiCall, orgId } = useAuth();

  // Scope the api request to the current organization
  const key = orgScoped ? orgId + "::" + path : path;

  const allowed = shouldRun ? shouldRun() : true;

  const config: SWRConfiguration = {};

  if (!autoRevalidate) {
    config.revalidateOnFocus = false;
    config.revalidateOnReconnect = false;
  }

  if (refreshInterval !== undefined) {
    config.refreshInterval = refreshInterval;
  }

  return useSWR<Response, Error>(
    allowed ? key : null,
    async () => apiCall<Response>(path, { method: "GET" }),
    config,
  );
}

export function useValidatedApi<Z extends z.ZodType>(
  path: string,
  schema: Z,
  {
    shouldRun,
    autoRevalidate = true,
    orgScoped = true,
    refreshInterval,
  }: UseApiOptions = {},
) {
  // const { apiCall, orgId } = useAuth();

  // const key = orgScoped ? orgId + "::" + path : path;
  // const allowed = shouldRun ? shouldRun() : true;

  // const config: SWRConfiguration = {};
  // if (!autoRevalidate) {
  //   config.revalidateOnFocus = false;
  //   config.revalidateOnReconnect = false;
  // }
  // if (refreshInterval !== undefined) {
  //   config.refreshInterval = refreshInterval;
  // }

  // return useSWR<z.infer<Z>, Error>(
  //   allowed ? key : null,
  //   async () => {
  //     const raw = await apiCall(path, { method: "GET" });
  //     const result = schema.safeParse(raw);
  //     if (result.success) return result.data;
  //     throw new Error(result.error.message);
  //   },
  //   config,
  // );
  const { data, error, isLoading } = useApi<z.infer<Z>>(path, {
    shouldRun,
    autoRevalidate,
    orgScoped,
    refreshInterval,
  });
  const parsedData = schema.safeParse(data);
  return { data: parsedData.data, error, isLoading };
}
