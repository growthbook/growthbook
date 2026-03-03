import { ApprovalFlowTargetType, ApprovalFlow } from "shared/enterprise";
import useApi from "./useApi";

export function useApprovalFlows() {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlow[];
  }>(`/approval-flow`);

  return {
    approvalFlows: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useApprovalFlowsEntityType(entityType: ApprovalFlowTargetType) {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlow[];
  }>(`/approval-flow/entity/${entityType}`);

  return {
    approvalFlows: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useApprovalFlowsEntityId(
  entityType: ApprovalFlowTargetType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlow[];
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
    approvalFlow: ApprovalFlow;
  }>(`/approval-flow/${approvalFlowId}`);

  return {
    approvalFlow: data?.approvalFlow,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionHistory(
  entityType: ApprovalFlowTargetType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    approvalFlows: ApprovalFlow[];
  }>(`/approval-flow/entity/${entityType}/${entityId}/history`);

  return {
    revisions: data?.approvalFlows || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}
