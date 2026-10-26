import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { useEntityRevision } from "@/hooks/useEntityRevision";

export function useSDKConnectionRevision(
  sdkConnectionId: string | undefined,
  sdkConnectionMutate: () => void,
  connection?: SDKConnectionInterface,
  { autoSelectDrafts = true }: { autoSelectDrafts?: boolean } = {},
) {
  return useEntityRevision({
    entityType: "sdk-connection",
    entityId: sdkConnectionId,
    entityMutate: sdkConnectionMutate,
    entity: connection,
    // SDK connections have no owner.
    ownerId: "",
    autoSelectDrafts,
  });
}
