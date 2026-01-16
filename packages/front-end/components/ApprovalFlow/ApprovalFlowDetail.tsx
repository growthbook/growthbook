import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex, Text, Card } from "@radix-ui/themes";
import { PiCaretDown,PiCaretLeft } from "react-icons/pi";
import { date, ago } from "shared/dates";
import { ApprovalFlowInterface } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import RadioGroup from "@/ui/RadioGroup";
import Field from "@/components/Forms/Field";
import Dropdown from "@/components/Dropdown/Dropdown";
import {
  checkMergeConflicts,
  MergeResult,
  canAdminBypassApprovalFlow,
  requiresApprovalForEntity,
  canUserReviewEntity,
} from "shared/enterprise";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import { ApprovalEntityType, ApprovalFlowEntity, ApprovalFlowEntityType } from "shared/src/validators/approval-flows";
import LoadingOverlay from "@/components/LoadingOverlay";
interface ApprovalFlowDetailProps {
  approvalFlow: ApprovalFlowInterface;
  currentState: ApprovalFlowEntityType["originalEntity"];
  mutate?: () => void;
  setCurrentApprovalFlow: (flow: ApprovalFlowInterface | null) => void;
}

const flattenObject = (
  obj: unknown,
  prefix = ""
): Record<string, unknown> => {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return { [prefix]: obj };
  }
  if (Array.isArray(obj)) {
    return { [prefix]: obj };
  }
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length === 0
    ) {
      flattened[newPrefix] = value;
    } else {
      Object.assign(flattened, flattenObject(value, newPrefix));
    }
  }
  return flattened;
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

const ApprovalFlowDetail: React.FC<ApprovalFlowDetailProps> = ({
  approvalFlow,
  currentState,
  mutate,
  setCurrentApprovalFlow,
}) => {
  const { getUserDisplay, userId, superAdmin } = useUser();
  const { apiCall } = useAuth();
  const [comment, setComment] = useState("");
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewDropdownOpen, setReviewDropdownOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<string>("comment");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const orgSettings = useOrgSettings();
  const { user } = useUser();
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

  useEffect(() => {
      if (!approvalFlow.entity.originalEntity || !approvalFlow.entity.proposedChanges || !currentState) {
        setMergeResult(null);
        return;
      }
      const result = checkMergeConflicts(
        approvalFlow.entity.originalEntity,
        currentState,
        approvalFlow.entity.proposedChanges
      );
      setMergeResult(result);
  }, [approvalFlow.id, approvalFlow.entity.originalEntity, approvalFlow.entity.proposedChanges, currentState]);
  // Group activity by date (must be before early return to follow rules of hooks)
  if (!approvalFlow) return <LoadingOverlay />;

    const allActivity = [
      ...approvalFlow.reviews.map((r) => ({
        type: "review" as const,
        id: r.id,
        userId: r.userId,
        createdAt: r.createdAt,
        decision: r.decision,
        comment: r.comment,
      })),
      ...approvalFlow.activityLog
        .filter((a) => !["reviewed", "commented", "approved", "requested-changes"].includes(a.action))
        .map((a) => ({
          type: "activity" as const,
          id: a.id,
          userId: a.userId,
          createdAt: a.createdAt,
          action: a.action,
          details: a.details,
        })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const groupedActivity: Record<string, typeof allActivity> = {};
    allActivity.forEach((item) => {
      const dateKey = date(item.createdAt);
      if (!groupedActivity[dateKey]) groupedActivity[dateKey] = [];
      groupedActivity[dateKey].push(item);
    });


  const isOpen =
    approvalFlow.status !== "merged" && approvalFlow.status !== "closed";
  const canUserReview = canUserReviewEntity({
    entityType: approvalFlow.entity.entityType as ApprovalEntityType,
    approvalFlow,
    entity: currentState,
    approvalFlowSettings: orgSettings.approvalFlow,
    userRole: user?.role,
    userId: userId || "",
  });
  console.log("canUserReview", canUserReview);
  // Handle submitting a review
  const handleSubmitReview = async (
    decision: "approve" | "request-changes" | "comment",
    reviewCommentText: string
  ) => {
    setIsSubmitting(true);
    setReviewError(null);
    try {
      const response = await apiCall<{ approvalFlow: ApprovalFlowInterface }>(`/approval-flow/${approvalFlow.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment: reviewCommentText,
        }),
      });
      
      // Update the current approval flow with the response
      if (response.approvalFlow) {
        setCurrentApprovalFlow(response.approvalFlow);
      }
      
      // Also refresh the list in the background
      mutate?.();
      
      setComment("");
      setReviewComment("");
      setReviewDecision("comment");
      setReviewDropdownOpen(false);

    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate diff
  const flatProposed = flattenObject(approvalFlow.entity.proposedChanges);
  const flatCurrent: Record<string, unknown> = {};
  for (const key of Object.keys(flatProposed)) {
    const keys = key.split(".");
    let value: unknown = currentState;
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
      if (value === undefined) break;
    }
    flatCurrent[key] = value;
  }

  const changedFields = Object.keys(flatProposed).filter(
    (key) => formatValue(flatCurrent[key]) !== formatValue(flatProposed[key])
  );

  const toggleCollapsed = (id: string) => {
    const newCollapsedItems = new Set(collapsedItems);
    if (newCollapsedItems.has(id)) {
      newCollapsedItems.delete(id);
    } else {
      newCollapsedItems.add(id);
    }
    setCollapsedItems(newCollapsedItems);
  };

  const handleAddComment = async () => {
    if (!comment.trim()) return;
    await handleSubmitReview("comment", comment);
  };

  const handleMerge = async () => {
    setIsSubmitting(true);
    setMergeError(null);
    try {
      const response = await apiCall<{ approvalFlow: ApprovalFlowInterface }>(`/approval-flow/${approvalFlow.id}/merge`, {
        method: "POST",
      });
      
      // Update the current approval flow with the response
      if (response.approvalFlow) {
        setCurrentApprovalFlow(response.approvalFlow);
      }
      
      // Also refresh the list in the background
      mutate?.();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Failed to merge");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = async () => {
    setIsSubmitting(true);
    setCloseError(null);
    try {
      const response = await apiCall<{ approvalFlow: ApprovalFlowInterface }>(`/approval-flow/${approvalFlow.id}/close`, {
        method: "POST",
      });
      
      // Update the current approval flow with the response
      if (response.approvalFlow) {
        setCurrentApprovalFlow(response.approvalFlow);
      }
      
      // Also refresh the list in the background
      mutate?.();
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Failed to close");
    } finally {
      setIsSubmitting(false);
    }
  };
  const canMerge = () => {
    return approvalFlow.status === "approved" || canAdminBypassApprovalFlow(approvalFlow.entity.entityType as ApprovalEntityType, currentState, orgSettings.approvalFlow, superAdmin, user?.role) || !requiresApprovalForEntity(approvalFlow.entity.entityType as ApprovalEntityType, currentState , orgSettings.approvalFlow);
  };

  const getActivityLabel = (
    item: (typeof groupedActivity)[string][number]
  ): { label: string; junctionCopy: string; color: string } => {
    if (item.type === "review") {
      switch (item.decision) {
        case "approve":
          return { label: "Approved Changes", junctionCopy: "by", color: "var(--green-7)" };
        case "request-changes":
          return { label: "Requested Changes", junctionCopy: "by", color: "var(--orange-7)" };
        case "comment":
          return { label: "Comment", junctionCopy: "by", color: "var(--violet-7)" };
        default:
          return { label: "Review", junctionCopy: "by", color: "var(--gray-7)" };
      }
    }
    // Activity log
    switch (item.action) {
      case "merged":
        return { label: "Merged", junctionCopy: "by", color: "var(--violet-7)" };
      case "closed":
        return { label: "Closed", junctionCopy: "by", color: "var(--red-7)" };
      case "reopened":
        return { label: "Reopened", junctionCopy: "by", color: "var(--blue-7)" };
      case "created":
        return { label: "Pending Approval", junctionCopy: "requested by", color: "var(--violet-7)" };
      case "updated":
        return { label: "Updated", junctionCopy: "by", color: "var(--violet-7)" };
      default:
        return { label: item.action, junctionCopy: "by", color: "var(--gray-9)" };
    }
  };
  return (
    <div className="container-fluid pagecontents">
      {/* Header */}
      <Box mb="4">
        <Button
          variant="ghost"
          color="violet"
          size="xs"
          onClick={() => setCurrentApprovalFlow(null)}
        > 
          <Flex align="center" gap="1">
            <PiCaretLeft size={12} />
            <span>Back to list</span>
          </Flex>
        </Button>
      </Box>
      {mergeResult && !mergeResult.success && (
        <Callout status="error">
          <Text size="2">
            You have conflicts with the current state of the entity. Please resolve the conflicts
            before merging.
          </Text>
        </Callout>
      )}
      {mergeError && (
        <Callout status="error">
          <Text size="2">
            {mergeError}
          </Text>
        </Callout>
      )}
      <Flex justify="between" align="center" mb="4">
      <Text size="3" weight="medium">
        {date(approvalFlow.dateCreated)}
      </Text>
        <Flex gap="2">
          <Dropdown
            uuid="submit-review-dropdown"
            toggle={
              <Button variant="solid" color={!canMerge() || !!(!!mergeResult && !mergeResult.success)? "violet" : "gray"} disabled={!canUserReview}>
                Submit review <PiCaretDown className="ml-1" />
              </Button>
            }
            caret={false}
            width={320}
            open={reviewDropdownOpen}
            setOpen={setReviewDropdownOpen}
          >
            <Box p="3" onClick={(e) => e.stopPropagation()}>
              <Text size="2" weight="medium" mb="2" as="p">
                Leave a comment
              </Text>
              <Field
                textarea
                minRows={2}
                placeholder="Add your review comment..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
              <Box my="3">
                <RadioGroup
                  value={reviewDecision}
                  setValue={setReviewDecision}
                  options={[
                    {
                      value: "request-changes",
                      label: "Request Changes",
                      description: "Submit feedback that must be addressed",
                    },
                    {
                      value: "comment",
                      label: "Leave a comment",
                      description: "Submit general feedback without explicit approval.",
                    },
                    {
                      value: "approve",
                      label: "Approve",
                      description: "Approve and allow merging",
                    },
                  ]}
                />
              </Box>
              {reviewError && (
                <Text size="2" color="red" mb="2" as="p">
                  {reviewError}
                </Text>
              )}
              <Flex justify="end" gap="2" mt="3">
                <Button
                  variant="soft"
                  color="red"
                  stopPropagation
                  onClick={() => {
                    setReviewDropdownOpen(false);
                    setReviewComment("");
                    setReviewDecision("comment");
                    setReviewError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="solid"
                  color="violet"
                  stopPropagation
                  onClick={() => {
                    handleSubmitReview(
                      reviewDecision as "approve" | "request-changes" | "comment",
                      reviewComment
                    );
                  }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "Confirm"}
                </Button>
              </Flex>
            </Box>
          </Dropdown>
          <Button
              variant="solid"
              color="violet"
              onClick={handleMerge}
              disabled={
                isSubmitting || !canMerge() || !!(!!mergeResult && !mergeResult.success)
              }
            >
              Merge
          </Button>
        </Flex>
      </Flex>

      <Flex gap="5" direction={{ initial: "column", lg: "row" }} mb="6">
        <Box p="5" style={{ flex: 1, backgroundColor: "var(--white)", width: "100%", borderRadius: "var(--radius-2)" }}>
          {changedFields.length === 0 ? (
            <Text size="2" color="gray">
              No changes to display.
            </Text>
          ) : (
            <Box style={{ maxWidth: 706, width: "100%", maxHeight: 400, overflow: "scroll",  margin: "0 auto" }}>
            {changedFields.map((field) => {
              const oldValue = flatCurrent[field];
              const newValue = flatProposed[field];
              return (
                <Card key={field} mb="2" style={{ padding: "12px 16px"}}>
                  <Text weight="medium" size="2" as="p" mb="1">
                    {field}
                  </Text>
                  <Flex align="center" gap="2">
                    <Text size="2" style={{ color: "var(--gray-11)" }}>
                      {formatValue(oldValue)}
                    </Text>
                    <Text size="2" color="gray">
                      →
                    </Text>
                    <Text size="2" style={{ color: "var(--gray-12)" }}>
                      {formatValue(newValue)}
                    </Text>
                  </Flex>
                </Card>
              );
            })}
            </Box>
          )}
        </Box>
      </Flex>

      {/* Comments Section */}
      <Box mb="4">
        <Text size="3" weight="medium">
            Comments ({approvalFlow.reviews.length})
        </Text>
      </Box>
      <Box mb="5" p="5" style={{ backgroundColor: "var(--white)", borderRadius: "var(--radius-2)" }}>
        <Box style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
        <Box mb="" p="5" className="appbox" style={{ boxShadow: "0 12px 32px -16px rgba(0, 0, 51, 0.06), 0 8px 40px 0 rgba(0, 0, 0, 0.05), 0 0px 0 1px rgba(0, 0, 51, 0.06)", borderRadius: "var(--radius-2)" }}>
          <Text size="2" mb="2" as="p">
            Add a comment
          </Text>
          <Field
            textarea
            minRows={1}
            placeholder="Type to add a comment..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Flex justify="end" mt="2">
            <Button
              variant="solid"
              color="violet"
              onClick={handleAddComment}
              disabled={!comment.trim() || isSubmitting}
            >
              Add comment
            </Button>
          </Flex>
        </Box>


        {/* Activity feed grouped by date */}
        {Object.entries(groupedActivity).map(([dateStr, items]) => (
          <Box key={dateStr} mb="4">
            <Text size="2" color="gray" mb="3" as="p">
              {dateStr}
            </Text>

            {items.map((item) => {
              const { label, color, junctionCopy } = getActivityLabel(item);
              const hasComment = item.type === "review" && item.comment;

              return (
                <Box
                  key={item.id}
                  mb="3"
                  style={{
                    padding: "16px",
                    borderRadius: "var(--radius-5)",
                    borderTop: "1px solid var(--gray-4)",
                    borderBottom: "1px solid var(--gray-4)",
                    borderRight: "1px solid var(--gray-4)",
                    borderLeft: `5px solid ${color}`,
                    overflow: "hidden",
                    boxSizing: "content-box"
                  }}
                >
                  <Flex justify="between" align="start" mb="2">
                    <Text size="2" weight="medium">
                      {label} <Text size="2" weight="regular" as="span">{junctionCopy}</Text> {getUserDisplay(item.userId)}
                    </Text>
                    <Text size="2" weight="light" style={{ whiteSpace: "nowrap", marginLeft: 16 }}>
                      {ago(item.createdAt)}
                    </Text>
                  </Flex>

                  {hasComment ? (
                    <Text size="2">{item.comment}</Text>
                  ) : (
                    <Text size="2" weight="light" style={{ fontStyle: "italic", color: "var(--gray-10)" }}>
                      No comment
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
        </Box>
      </Box>

      {/* Action Buttons */}
      {isOpen && (
        <Box mb="5">
          {closeError && (
            <Callout status="error" mb="3">
              <Text size="2">
                {closeError}
              </Text>
            </Callout>
          )}
          <Flex gap="3" justify="end">
            <Button
              variant="outline"
              color="red"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Close
            </Button>
          </Flex>
        </Box>
      )}
    </div>
  );
};

export default ApprovalFlowDetail;
