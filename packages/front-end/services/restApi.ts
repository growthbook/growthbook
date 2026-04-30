import { useCallback } from "react";
import { z, ZodTypeAny } from "zod";
import type { ApiEndpointSpec } from "shared/api-spec";
import { useAuth } from "@/services/auth";

const SSO_CONNECTION_ID_HEADER = "X-SSO-Connection-ID";

type AnyEndpointSpec = ApiEndpointSpec<
  ZodTypeAny,
  ZodTypeAny,
  ZodTypeAny,
  ZodTypeAny
>;

// Endpoints opt out of a request part by setting its schema to `z.never()`,
// which makes `z.infer<...>` resolve to `never`. ArgEntry uses that to omit
// the corresponding key entirely; otherwise the key is required, unless the
// inferred object has only optional fields (in which case the key is optional).
type ArgEntry<K extends PropertyKey, V> = [V] extends [never]
  ? unknown
  : Record<string, never> extends V
    ? { [P in K]?: V }
    : { [P in K]: V };

type ArgsFor<T extends AnyEndpointSpec> = ArgEntry<
  "params",
  z.infer<T["paramsSchema"]>
> &
  ArgEntry<"body", z.infer<T["bodySchema"]>> &
  ArgEntry<"query", z.infer<T["querySchema"]>>;

// Make the second positional arg itself optional when no key is required.
type CallArgs<T extends AnyEndpointSpec> =
  Record<string, never> extends ArgsFor<T>
    ? [args?: ArgsFor<T>]
    : [args: ArgsFor<T>];

/**
 * Typed helper for calling the public REST API (`/api/v1/*`) from the
 * front-end. Pass a validator from `shared/validators` plus params/body/query;
 * the response type is inferred from the validator's `responseSchema`.
 *
 * Uses `fetchRaw` from `useAuth` so requests inherit the JWT, `X-Organization`
 * header, and silent-refresh behavior.
 */
export function useRestApiCall() {
  const { fetchRaw, ssoConnectionId } = useAuth();

  return useCallback(
    async <T extends AnyEndpointSpec, ResponseSchema extends ZodTypeAny>(
      spec: T & { responseSchema: ResponseSchema },
      ...rest: CallArgs<T>
    ): Promise<z.infer<ResponseSchema>> => {
      const { params, body, query } = (rest[0] ?? {}) as {
        params?: Record<string, unknown>;
        body?: unknown;
        query?: Record<string, unknown>;
      };
      const paramsObj = params
        ? Object.fromEntries(
            Object.entries(params).map(([k, v]) => [k, String(v)]),
          )
        : {};

      let url = `/api/v1${spec.path.replace(/:(\w+)/g, (_, p) => {
        const value = paramsObj[p];
        if (value === undefined || value === "") {
          throw new Error(`Missing required path parameter: ${p}`);
        }
        return encodeURIComponent(value);
      })}`;

      if (query && Object.keys(query).length > 0) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) {
            v.forEach((item) => qs.append(k, String(item)));
          } else {
            qs.set(k, String(v));
          }
        }
        const qsStr = qs.toString();
        if (qsStr) url += `?${qsStr}`;
      }

      const headers: Record<string, string> = {};
      if (ssoConnectionId) {
        headers[SSO_CONNECTION_ID_HEADER] = ssoConnectionId;
      }

      const response = await fetchRaw(url, {
        method: spec.method.toUpperCase(),
        body: body ? JSON.stringify(body) : undefined,
        headers,
        // We aren't using cookies, only auth headers
        credentials: "omit",
      });

      if (!response.ok) {
        let message = "There was an error";
        try {
          const errData = await response.json();
          message = errData?.message || message;
        } catch {
          // non-JSON error body; keep default message
        }
        throw new Error(message);
      }

      const responseData = await response.json();
      try {
        return spec.responseSchema.parse(responseData);
      } catch (e) {
        console.warn(
          `[useRestApiCall] response validation failed for ${spec.operationId}`,
          e,
        );
        return responseData as z.infer<ResponseSchema>;
      }
    },
    [fetchRaw, ssoConnectionId],
  );
}
