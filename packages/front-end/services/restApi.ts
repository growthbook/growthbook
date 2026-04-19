import { useCallback } from "react";
import { z, ZodTypeAny } from "zod";
import type { ApiEndpointSpec } from "shared/api-spec";
import { useAuth } from "@/services/auth";

type AnyEndpointSpec = ApiEndpointSpec<
  ZodTypeAny,
  ZodTypeAny,
  ZodTypeAny,
  ZodTypeAny
>;

type ArgsFor<T extends AnyEndpointSpec> = {
  params?: z.infer<T["paramsSchema"]>;
  body?: z.infer<T["bodySchema"]>;
  query?: z.infer<T["querySchema"]>;
};

/**
 * Typed helper for calling the public REST API (`/api/v1/*`) from the
 * front-end. Pass a validator from `shared/validators` plus params/body/query;
 * the response type is inferred from the validator's `responseSchema`.
 *
 * Uses `fetchRaw` from `useAuth` so requests inherit the JWT, `X-Organization`
 * header, and silent-refresh behavior.
 */
export function useRestApiCall() {
  const { fetchRaw } = useAuth();

  return useCallback(
    async <T extends AnyEndpointSpec>(
      spec: T,
      { params, body, query }: ArgsFor<T> = {},
    ): Promise<z.infer<T["responseSchema"]>> => {
      const paramsObj = params
        ? Object.fromEntries(
            Object.entries(params as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          )
        : {};

      let url = `/api/v1${spec.path.replace(
        /:(\w+)/g,
        (_, p) => paramsObj[p] ?? "",
      )}`;

      if (query && Object.keys(query).length > 0) {
        const queryObj = Object.fromEntries(
          Object.entries(query as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        );
        const qs = new URLSearchParams(queryObj).toString();
        if (qs) url += `?${qs}`;
      }

      const response = await fetchRaw(url, {
        method: spec.method.toUpperCase(),
        body: body ? JSON.stringify(body) : undefined,
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData?.message || "There was an error");
      }

      return responseData as z.infer<T["responseSchema"]>;
    },
    [fetchRaw],
  );
}
