import useSWR from "swr";
import { useAuth } from "../services/auth";

// eslint-disable-next-line
export default function useApi<Response = any>(path: string | null) {
  const { apiCall } = useAuth();
  const { orgId } = useAuth();

  // Scope the api request to the current organization
  const key = path === null ? null : orgId + "::" + path;

  return useSWR<Response, Error>(key, async () =>
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | null' is not assignable... Remove this comment to see the full error message
    apiCall<Response>(path, {
      method: "GET",
    })
  );
}
