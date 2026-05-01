import { useState } from "react";
import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { EventForwarderAccessTestResponse } from "shared/validators";
import { useAuth } from "@/services/auth";

export type EventForwarderAccessTestResult = {
  status: "success" | "error";
  message: string;
};

export function useEventForwarderAccessTest({
  existing,
  datasourceId,
  type,
  params,
  projects,
  eventForwarderConfig,
  eventForwarderAccessSignature,
  setValidatedEventForwarderSignature,
}: {
  existing: boolean;
  datasourceId?: string;
  type: DataSourceType;
  params?: Partial<DataSourceParams>;
  projects?: string[];
  eventForwarderConfig: EventForwarderConfigDraft | null;
  eventForwarderAccessSignature: string;
  setValidatedEventForwarderSignature?: (signature: string | null) => void;
}) {
  const { apiCall } = useAuth();
  const [eventForwarderTestResult, setEventForwarderTestResult] =
    useState<EventForwarderAccessTestResult | null>(null);

  async function testEventForwarderAccess() {
    if (!eventForwarderConfig) return;

    setEventForwarderTestResult(null);
    setValidatedEventForwarderSignature?.(null);
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
      setValidatedEventForwarderSignature?.(eventForwarderAccessSignature);
      setEventForwarderTestResult({
        status: "success",
        message:
          "Event Forwarder table creation access verified. GrowthBook created and deleted a temporary validation table.",
      });
    } else {
      setEventForwarderTestResult({
        status: "error",
        message:
          sinkWrite.resultMessage ||
          "Event Forwarder table creation access failed.",
      });
    }
  }

  return {
    eventForwarderTestResult,
    testEventForwarderAccess,
  };
}
