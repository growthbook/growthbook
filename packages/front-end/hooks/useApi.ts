import useSWR from "swr";
import { useAuth } from "../services/auth";

export const enum Method {
  GET = "GET",
  POST = "POST",
}

// eslint-disable-next-line
export default function useApi<Response = any>(
  path: string,
  method: Method = Method.GET,
  // eslint-disable-next-line
  body: any = null
) {
  const { apiCall } = useAuth();
  const { orgId } = useAuth();

  // Scope the api request to the current organization
  const key = orgId + "::" + path;
  const options = { method };
  // eslint-disable-next-line
  // @ts-ignore
  if (body) options.body = body;

  return useSWR<Response, Error>(key, async () =>
    apiCall<Response>(path, options)
  );
}
