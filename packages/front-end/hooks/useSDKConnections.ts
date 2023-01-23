import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import useApi from "./useApi";

export default function useSDKConnections() {
  return useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);
}
