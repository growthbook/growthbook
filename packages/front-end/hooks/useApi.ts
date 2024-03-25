import useSWR from "swr";
import { useAuth } from "@front-end/services/auth";

export default function useApi<Response = unknown>(path: string | null) {
  const { apiCall } = useAuth();
  const { orgId } = useAuth();

  // Scope the api request to the current organization
  const key = path === null ? null : orgId + "::" + path;

  return useSWR<Response, Error>(key, async () =>
    apiCall<Response>(path, {
      method: "GET",
    })
  );
}
