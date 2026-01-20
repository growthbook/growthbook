import useApi from "./useApi";
import { ApprovalEntityType, ApprovalFlowInterface } from "shared/validators";

export function useApprovalFlows() {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlowInterface[];
  }>(`/approval-flow`);

  return {
    approvalFlows: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useApprovalFlowsEntityType(entityType: ApprovalEntityType) {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlowInterface[];
  }>(`/approval-flow/entity/${entityType}`);

  return {
    approvalFlows: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useApprovalFlowsEntityId(
  entityType: ApprovalEntityType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlowInterface[];
  }>(`/approval-flow/entity/${entityType}/${entityId}`);
  return {
    approvalFlows: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}
export function useApprovalFlow(approvalFlowId: string) {
  const { data, error, mutate } = useApi<{
    approvalFlow: ApprovalFlowInterface;
  }>(`/approval-flow/${approvalFlowId}`);

  return {
    approvalFlow: data?.approvalFlow,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionHistory(
  entityType: ApprovalEntityType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    revisions: ApprovalFlowInterface[];
  }>(`/approval-flow/entity/${entityType}/${entityId}/history`);

  return {
    revisions: data?.revisions || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}
