import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useApi from "./useApi";

export default function useSDKConnections() {
  return useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);
}
