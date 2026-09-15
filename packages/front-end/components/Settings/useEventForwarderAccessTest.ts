import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { EventForwarderAccessTestResponse } from "shared/validators";
import { useAuth } from "@/services/auth";

export function useEventForwarderAccessTest({
  existing,
  datasourceId,
  type,
  params,
  projects,
  eventForwarderConfig,
}: {
  existing: boolean;
  datasourceId?: string;
  type: DataSourceType;
  params?: Partial<DataSourceParams>;
  projects?: string[];
  eventForwarderConfig: EventForwarderConfigDraft | null;
}) {
  const { apiCall } = useAuth();

  async function testEventForwarderAccess() {
    if (!eventForwarderConfig) return;

    const endpoint =
      existing && datasourceId
        ? `/datasource/${datasourceId}/event-forwarder/test-access`
        : "/datasources/event-forwarder/test-access";
    const body =
      existing && datasourceId
        ? {
            ...(params ? { params } : {}),
            eventForwarderConfig,
          }
        : {
            type,
            params: params || {},
            projects,
            eventForwarderConfig,
          };

    const response = await apiCall<EventForwarderAccessTestResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const sinkWrite = response.results.sinkWrite;
    if (sinkWrite.result === "success") {
      return;
    }
    throw new Error(sinkWrite.resultMessage || "Write test permission denied.");
  }

  return {
    testEventForwarderAccess,
  };
}
