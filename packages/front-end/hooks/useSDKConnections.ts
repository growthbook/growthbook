import { useMemo } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useApi from "./useApi";

// The connections that serve a payload. An archived one serves nothing, so it
// can't satisfy a checklist or count toward what SDKs support; ask for those
// only where they are listed or managed.
export default function useSDKConnections({
  includeArchived = false,
}: { includeArchived?: boolean } = {}) {
  const response = useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);
  const { data } = response;
  const filtered = useMemo(
    () =>
      data && !includeArchived
        ? { ...data, connections: data.connections.filter((c) => !c.archived) }
        : data,
    [data, includeArchived],
  );
  return { ...response, data: filtered };
}
