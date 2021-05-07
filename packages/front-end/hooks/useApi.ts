import useSWR, { responseInterface, ConfigInterface } from "swr";
import { useAuth } from "../services/auth";

// eslint-disable-next-line
export default function useApi<Response = any, Error = any>(path: string, config?: ConfigInterface<Response, Error>): responseInterface<Response, Error> {
  const { apiCall } = useAuth();

  return useSWR(
    path,
    async () =>
      apiCall<Response>(path, {
        method: "GET",
      }),
    config
  );
}
