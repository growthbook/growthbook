import useSWR from "swr";
import { useAuth } from "../services/auth";

// eslint-disable-next-line
export default function useApi<Response = any>(path: string) {
  const { apiCall } = useAuth();
  const { orgId } = useAuth();

  // Scope the api request to the current organization
  const key = orgId + "::" + path;

  return useSWR<Response, Error>(key, async () =>
    apiCall<Response>(path, {
      method: "GET",
    })
  );
}
