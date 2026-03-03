import React, { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { date, ago } from "shared/dates";
import {
  ApprovalFlow,
  checkMergeConflicts,
  MergeResult,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import RadioGroup from "@/ui/RadioGroup";
import Field from "@/components/Forms/Field";
import Dropdown from "@/components/Dropdown/Dropdown";
import DropdownLink from "@/components/Dropdown/DropdownLink";
import Callout from "@/ui/Callout";
import Modal from "@/components/Modal";
import Tooltip from "@/ui/Tooltip";
import SplitButton from "@/ui/SplitButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { ExpandableDiff } from "@/components/Features/DraftModal";
interface ApprovalFlowDetailProps {
  approvalFlow: ApprovalFlow;
  currentState: ApprovalFlow["target"]["snapshot"];
  mutate?: () => void;
  setCurrentApprovalFlow: (flow: ApprovalFlow | null) => void;
  onDiscard: (flowId: string) => Promise<void>;
}

const flattenObject = (obj: unknown, prefix = ""): Record<string, unknown> => {
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
  onDiscard,
}) => {
  const { getUserDisplay, userId } = useUser();
  const { apiCall } = useAuth();
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const [bypassDropdownOpen, setBypassDropdownOpen] = useState(false);
  const [reviewDropdownOpen, setReviewDropdownOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<
    "approve" | "request-changes" | "comment"
  >("comment");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const permissionsUtil = usePermissionsUtil();

  useEffect(() => {
    if (
      !approvalFlow.target.snapshot ||
      !approvalFlow.target.proposedChanges ||
      !currentState
    ) {
      setMergeResult(null);
      return;
    }
    const result = checkMergeConflicts(
      approvalFlow.target.snapshot as unknown as Record<string, unknown>,
      currentState as unknown as Record<string, unknown>,
      approvalFlow.target.proposedChanges as Record<string, unknown>,
    );
    setMergeResult(result);
  }, [
    approvalFlow.id,
    approvalFlow.target.snapshot,
    approvalFlow.target.proposedChanges,
    currentState,
  ]);
  // Group activity by date

  const allActivity = [
    ...approvalFlow.reviews.map((r) => ({
      type: "review" as const,
      id: r.id,
      userId: r.userId,
      createdAt: r.dateCreated,
      decision: r.decision,
      details: r.comment,
    })),
    ...approvalFlow.activityLog
      .filter(
        (a) =>
          !["reviewed", "commented", "approved", "requested-changes"].includes(
            a.action,
          ),
      )
      .map((a) => ({
        type: "activity" as const,
        id: a.id,
        userId: a.userId,
        createdAt: a.dateCreated,
        action: a.action,
        details: a.description,
      })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const groupedActivity: Record<string, typeof allActivity> = {};
  allActivity.forEach((item) => {
    const dateKey = date(item.createdAt);
    if (!groupedActivity[dateKey]) groupedActivity[dateKey] = [];
    groupedActivity[dateKey].push(item);
  });

  const isOpen =
    approvalFlow.status !== "merged" && approvalFlow.status !== "closed";

  const canUserReview =
    !!userId &&
    permissionsUtil.canUpdateSavedGroup(
      currentState as SavedGroupInterface,
      {},
    );
  // Handle submitting a review
  const handleSubmitReview = async (
    decision: "approve" | "request-changes" | "comment",
    reviewCommentText: string,
  ) => {
    setIsSubmitting(true);
    setReviewError(null);
    try {
      const response = await apiCall<{ approvalFlow: ApprovalFlow }>(
        `/approval-flow/${approvalFlow.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            comment: reviewCommentText,
          }),
        },
      );

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
      setReviewError(
        error instanceof Error ? error.message : "Failed to submit review",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate diff
  const flatProposed = flattenObject(approvalFlow.target.proposedChanges);
  const flatCurrent: Record<string, unknown> = {};
  for (const key of Object.keys(flatProposed)) {
    const keys = key.split(".");
    let value: unknown =
      approvalFlow.status === "merged"
        ? approvalFlow.target.snapshot
        : currentState;
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
      if (value === undefined) break;
    }
    flatCurrent[key] = value;
  }

  const changedFields = Object.keys(flatProposed).filter(
    (key) => formatValue(flatCurrent[key]) !== formatValue(flatProposed[key]),
  );

  const handleAddComment = async () => {
    if (!comment.trim()) return;
    await handleSubmitReview("comment", comment);
  };

  const handleMerge = async () => {
    setIsSubmitting(true);
    setMergeError(null);
    try {
      const response = await apiCall<{ approvalFlow: ApprovalFlow }>(
        `/approval-flow/${approvalFlow.id}/merge`,
        {
          method: "POST",
        },
      );

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

  const canMerge = (): boolean => {
    if (!isOpen) return false;
    if (!!mergeResult && !mergeResult.success) return false;
    if (approvalFlow.status !== "approved") return false;
    return permissionsUtil.canUpdateSavedGroup(
      currentState as SavedGroupInterface,
      {},
    );
  };

  const canBypass =
    isOpen &&
    permissionsUtil.canBypassApprovalChecks({
      project: (currentState as SavedGroupInterface).projects?.[0] || "",
    });

  const getActivityLabel = (
    item: (typeof groupedActivity)[string][number],
  ): { label: string; junctionCopy: string; color: string } => {
    if (item.type === "review") {
      switch (item.decision) {
        case "approve":
          return {
            label: "Approved Changes",
            junctionCopy: "by",
            color: "var(--green-7)",
          };
        case "request-changes":
          return {
            label: "Requested Changes",
            junctionCopy: "by",
            color: "var(--orange-7)",
          };
        case "comment":
          return {
            label: "Comment",
            junctionCopy: "by",
            color: "var(--violet-7)",
          };
        default:
          return {
            label: "Review",
            junctionCopy: "by",
            color: "var(--gray-7)",
          };
      }
    }
    // Activity log
    switch (item.action) {
      case "merged":
        return {
          label: "Merged",
          junctionCopy: "by",
          color: "var(--violet-7)",
        };
      case "closed":
        return { label: "Closed", junctionCopy: "by", color: "var(--red-7)" };
      case "reopened":
        return {
          label: "Reopened",
          junctionCopy: "by",
          color: "var(--blue-7)",
        };
      case "created":
        return {
          label: "Changes requested",
          junctionCopy: "by",
          color: "var(--violet-7)",
        };
      case "updated":
        return {
          label: "Updated",
          junctionCopy: "by",
          color: "var(--violet-7)",
        };
      default:
        return {
          label: item.action,
          junctionCopy: "by",
          color: "var(--gray-9)",
        };
    }
  };
  return (
    <Box>
      {confirmDiscard && (
        <Modal
          trackingEventModalType=""
          header="Discard Draft"
          close={() => setConfirmDiscard(false)}
          open={true}
          cta="Discard"
          submitColor="danger"
          submit={async () => {
            await onDiscard(approvalFlow.id);
          }}
        >
          Are you sure you want to discard this proposed change? This action
          cannot be undone.
        </Modal>
      )}
      {confirmPublish && (
        <Modal
          trackingEventModalType=""
          header="Publish Changes"
          close={() => setConfirmPublish(false)}
          open={true}
          cta="Publish"
          submitColor="primary"
          submit={handleMerge}
        >
          These changes will go live immediately. Are you sure you want to
          publish?
        </Modal>
      )}
      {confirmBypass && (
        <Modal
          trackingEventModalType=""
          header="Bypass Approval & Publish"
          close={() => setConfirmBypass(false)}
          open={true}
          cta="Publish Anyway"
          submitColor="danger"
          submit={handleMerge}
        >
          This will publish without approval and go live immediately. Are you
          sure you want to continue?
        </Modal>
      )}
      {mergeResult && !mergeResult.success && (
        <Callout status="error" mb="4">
          <Text size="medium">
            You have conflicts with the current state of the entity. Please
            resolve the conflicts before merging.
          </Text>
        </Callout>
      )}
      {mergeError && (
        <Callout status="error" mb="4">
          <Text size="medium">{mergeError}</Text>
        </Callout>
      )}
      {approvalFlow.status === "merged" && (
        <Callout status="info" mb="4">
          <Text size="medium">This approval flow has been merged.</Text>
        </Callout>
      )}
      <Flex justify="between" align="center" mb="4">
        <Text size="large" weight="medium">
          {date(approvalFlow.dateCreated)}
        </Text>
        <Flex gap="2">
          {isOpen && (
            <Button
              variant="ghost"
              color="red"
              onClick={() => setConfirmDiscard(true)}
              disabled={isSubmitting}
            >
              Discard
            </Button>
          )}
          <Dropdown
            uuid="submit-review-dropdown"
            toggle={
              <Button
                variant="solid"
                disabled={
                  approvalFlow.status === "closed" ||
                  approvalFlow.status === "merged"
                }
              >
                Submit review <PiCaretDown style={{ marginLeft: "4px" }} />
              </Button>
            }
            caret={false}
            width={320}
            open={reviewDropdownOpen}
            setOpen={setReviewDropdownOpen}
          >
            <Box p="3" onClick={(e) => e.stopPropagation()}>
              <Text size="medium" weight="medium" mb="2" as="p">
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
                  setValue={(v) =>
                    setReviewDecision(
                      v as "approve" | "request-changes" | "comment",
                    )
                  }
                  options={[
                    {
                      value: "comment",
                      label: "Comment",
                      description: "Leave a comment without a decision",
                      disabled: false,
                    },
                    {
                      value: "request-changes",
                      label: "Request Changes",
                      description: "Submit feedback that must be addressed",
                      disabled: false,
                    },
                    {
                      value: "approve",
                      label: "Approve",
                      description: "Approve and allow merging",
                      disabled: false,
                    },
                  ]}
                />
              </Box>
              {!canUserReview && (
                <Text size="small" color="text-low">
                  Permission checks are validated on submit.
                </Text>
              )}
              {reviewError && (
                <Text size="medium" mb="2" as="p">
                  {reviewError}
                </Text>
              )}
              <Flex justify="end" mt="3">
                <Button
                  variant="solid"
                  color="violet"
                  stopPropagation
                  onClick={() => {
                    handleSubmitReview(reviewDecision, reviewComment);
                  }}
                  disabled={
                    isSubmitting ||
                    (reviewDecision === "comment" && !reviewComment.trim())
                  }
                >
                  {isSubmitting ? "Submitting..." : "Confirm"}
                </Button>
              </Flex>
            </Box>
          </Dropdown>
          {canBypass ? (
            <SplitButton
              menu={
                <Dropdown
                  uuid="bypass-publish-dropdown"
                  toggle={
                    <Button
                      variant="solid"
                      color="violet"
                      disabled={isSubmitting}
                    >
                      <Box mx="-2">
                        <PiCaretDown />
                      </Box>
                    </Button>
                  }
                  caret={false}
                  open={bypassDropdownOpen}
                  setOpen={setBypassDropdownOpen}
                >
                  <DropdownLink onClick={() => setConfirmBypass(true)}>
                    Bypass approval & publish now
                  </DropdownLink>
                </Dropdown>
              }
            >
              {!canMerge() && (
                <Tooltip content="Approval is required before publishing">
                  <Button
                    variant="solid"
                    color="violet"
                    onClick={() => setConfirmPublish(true)}
                    disabled={isSubmitting || !canMerge()}
                    style={!canMerge() ? { pointerEvents: "none" } : undefined}
                  >
                    Publish
                  </Button>
                </Tooltip>
              )}
            </SplitButton>
          ) : (
            <Tooltip
              content="Approval is required before publishing"
              enabled={!canMerge() && !isSubmitting}
            >
              <span style={{ display: "inline-block" }}>
                <Button
                  variant="solid"
                  color="violet"
                  onClick={() => setConfirmPublish(true)}
                  disabled={isSubmitting || !canMerge()}
                  style={!canMerge() ? { pointerEvents: "none" } : undefined}
                >
                  Publish
                </Button>
              </span>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      <Box mb="6">
        {changedFields.length === 0 ? (
          <Text size="medium" color="text-low">
            No changes to display.
          </Text>
        ) : (
          <Box>
            {changedFields.map((field, i) => (
              <ExpandableDiff
                key={field}
                title={field}
                a={formatValue(flatCurrent[field])}
                b={formatValue(flatProposed[field])}
                defaultOpen={i === 0}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Comments Section */}
      <Box mb="4">
        <Text size="large" weight="medium">
          Comments ({approvalFlow.reviews.length})
        </Text>
      </Box>
      <Box
        mb="5"
        p="5"
        style={{
          borderRadius: "var(--radius-2)",
        }}
      >
        <Box style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}>
          <Box
            mb=""
            p="5"
            style={{
              boxShadow:
                "0 12px 32px -16px rgba(0, 0, 51, 0.06), 0 8px 40px 0 rgba(0, 0, 0, 0.05), 0 0px 0 1px rgba(0, 0, 51, 0.06)",
              borderRadius: "var(--radius-2)",
            }}
          >
            <Text size="medium" mb="2" as="p">
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
              <Text size="medium" color="text-low" mb="3" as="p">
                {dateStr}
              </Text>

              {items.map((item) => {
                const { label, color, junctionCopy } = getActivityLabel(item);
                const hasComment = !!item.details;

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
                      boxSizing: "content-box",
                    }}
                  >
                    <Flex justify="between" align="start" mb="2">
                      <Text size="medium" weight="medium">
                        {label}{" "}
                        <Text size="medium" weight="regular" as="span">
                          {junctionCopy}
                        </Text>{" "}
                        {getUserDisplay(item.userId)}
                      </Text>
                      <Text
                        size="medium"
                        weight="regular"
                        whiteSpace="nowrap"
                        ml="4"
                      >
                        {ago(item.createdAt)}
                      </Text>
                    </Flex>

                    {hasComment && <Text size="medium">{item.details}</Text>}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default ApprovalFlowDetail;
