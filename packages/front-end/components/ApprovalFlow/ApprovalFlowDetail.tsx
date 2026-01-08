import React, { useState, useMemo } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Text, Card, Heading } from "@radix-ui/themes";
import { PiCaretDown,PiCaretLeft,PiCopy } from "react-icons/pi";
import { date, ago } from "shared/dates";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";
import RadioGroup from "@/ui/RadioGroup";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Code from "@/components/SyntaxHighlighting/Code";
import Field from "@/components/Forms/Field";
import { useApprovalFlowSQL } from "@/hooks/useApprovalFlowSQL";
import { useDefinitions } from "@/services/DefinitionsContext";
import Dropdown from "@/components/Dropdown/Dropdown";

interface ApprovalFlowDetailProps {
  approvalFlow: ApprovalFlowInterface;
  currentState: Record<string, unknown>;
  mutate: () => void;
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
  const { getUserDisplay, userId } = useUser();
  const { apiCall } = useAuth();
  const { getFactTableById } = useDefinitions();
  const [comment, setComment] = useState("");
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewDropdownOpen, setReviewDropdownOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<string>("comment");
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Get SQL preview data
  const { currentSql, hasSql } = useApprovalFlowSQL(
    approvalFlow?.entityType,
    currentState,
    approvalFlow?.proposedChanges,
    getFactTableById
  );

  // Group activity by date (must be before early return to follow rules of hooks)
  const groupedActivity = useMemo(() => {
    if (!approvalFlow) return {};
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
        .filter((a) => !["reviewed", "commented"].includes(a.action))
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

    const grouped: Record<string, typeof allActivity> = {};
    allActivity.forEach((item) => {
      const dateKey = date(item.createdAt);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });

    return grouped;
  }, [approvalFlow?.reviews, approvalFlow?.activityLog]);

  if (!approvalFlow) return null;

  const isOpen =
    approvalFlow.status !== "merged" && approvalFlow.status !== "closed";
  const isAuthor = userId === approvalFlow.author;
  const canUserReview =true || (isOpen && !isAuthor);

  // Handle submitting a review
  const handleSubmitReview = async (
    decision: "approve" | "request-changes" | "comment",
    reviewCommentText: string
  ) => {
    setIsSubmitting(true);
    setReviewError(null);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment: reviewCommentText,
        }),
      });
      mutate();
      setComment("");
      setReviewComment("");
      setReviewDecision("comment");
      setReviewDropdownOpen(false);
    } catch (error) {
      console.error("Failed to submit review:", error);
      setReviewError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate diff
  const flatProposed = flattenObject(approvalFlow.proposedChanges);
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

  const getActivityLabel = (
    item: (typeof groupedActivity)[string][number]
  ): { label: string; color: string } => {
    if (item.type === "review") {
      switch (item.decision) {
        case "approve":
          return { label: "Approved Changes", color: "var(--green-9)" };
        case "request-changes":
          return { label: "Requested Changes", color: "var(--orange-9)" };
        case "comment":
          return { label: "left a comment", color: "var(--gray-9)" };
        default:
          console.log("review", item);
          return { label: "Review", color: "var(--gray-9)" };
      }
    }
    // Activity log
    switch (item.action) {
      case "merged":
        return { label: "Merged", color: "var(--purple-9)" };
      case "closed":
        return { label: "Closed", color: "var(--gray-9)" };
      case "reopened":
        return { label: "Reopened", color: "var(--blue-9)" };
      default:
        return { label: item.action, color: "var(--gray-9)" };
    }
  };

  const backPath =
    approvalFlow.entityType === "fact-metric"
      ? "/metrics#approvalflows"
      : "/fact-tables";

  return (
    <div className="container-fluid pagecontents">
      {/* Header */}
      <Flex justify="between" align="center" mb="4">
        <button
          onClick={() => setCurrentApprovalFlow(null)}
          className="btn btn-link p-0"
          style={{ textDecoration: "none" }}
        >
          <Flex align="center" gap="1">
            <PiCaretLeft size={12} />
            <span>Back to list</span>
          </Flex>
        </button>

        {canUserReview && (
          <Dropdown
            uuid="submit-review-dropdown"
            toggle={
              <button className="btn btn-primary">
                Submit review <PiCaretDown className="ml-1" />
              </button>
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
                  color="secondary"
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
                  color="primary"
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
        )}
      </Flex>

      <Text size="2" color="gray" mb="4" as="p">
        {date(approvalFlow.dateCreated)}
      </Text>

      <Flex gap="5" direction={{ initial: "column", lg: "row" }} mb="5">
        <Box style={{ flex: 1 }}>
          {changedFields.length === 0 ? (
            <Text size="2" color="gray">
              No changes to display.
            </Text>
          ) : (
            changedFields.map((field) => {
              const oldValue = flatCurrent[field];
              const newValue = flatProposed[field];
              return (
                <Card key={field} mb="2" style={{ padding: "12px 16px" }}>
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
            })
          )}
        </Box>

        {/* Right: SQL Preview */}
        {hasSql && currentSql && (
          <Box style={{ flex: 1 }}>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <Flex
                justify="between"
                align="center"
                px="3"
                py="2"
                style={{ borderBottom: "1px solid var(--gray-4)" }}
              >
                <Text weight="medium" size="2">
                  SQL
                </Text>
                <button
                  className="btn btn-link p-0"
                  onClick={() => navigator.clipboard.writeText(currentSql)}
                  title="Copy SQL"
                >
                  <PiCopy size={12} style={{ color: "var(--gray-9)" }} />
                </button>
              </Flex>
              <Box style={{ maxHeight: 400, overflow: "auto" }}>
                <Code language="sql" code={currentSql} />
              </Box>
            </Card>
          </Box>
        )}
      </Flex>

      {/* Comments Section */}
      <Box mb="5">
        <Heading size="3" mb="3">
          Comments ({approvalFlow.reviews.length})
        </Heading>

        {/* Add comment form */}
        <Box mb="4">
          <Text size="2" weight="medium" mb="2" as="p">
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
              color="violet"
              onClick={handleAddComment}
              disabled={!comment.trim() || isSubmitting}
            >
              Add comment
            </Button>
          </Flex>
        </Box>

        <hr className="my-4" />

        {/* Activity feed grouped by date */}
        {Object.entries(groupedActivity).map(([dateStr, items]) => (
          <Box key={dateStr} mb="4">
            <Text size="2" color="gray" mb="3" as="p">
              {dateStr}
            </Text>

            {items.map((item) => {
              const { label, color } = getActivityLabel(item);
              const isComment = item.type === "review" && item.decision === "comment";
              const hasComment = item.type === "review" && item.comment;
              const isCollapsedItem = collapsedItems.has(item.id);

              if (isComment && hasComment) {
                // Comment style - show user name and comment inline
                return (
                  <Card key={item.id} mb="2" style={{ padding: "12px 16px" }}>
                    <Text size="2" weight="medium" as="p" mb="2">
                      {getUserDisplay(item.userId)} {label}
                    </Text>
                    <Box
                      pl="3"
                      style={{ borderLeft: "2px solid var(--gray-4)" }}
                    >
                      <Flex justify="between" align="start">
                        <Text size="2">{item.comment}</Text>
                        <Text size="1" color="gray" style={{ whiteSpace: "nowrap", marginLeft: 16 }}>
                          {ago(item.createdAt)}
                        </Text>
                      </Flex>
                    </Box>
                  </Card>
                );
              }

              // Review/Activity style - colored header bar
              return (
                <Card
                  key={item.id}
                  mb="2"
                  style={{ padding: 0, overflow: "hidden" }}
                >
                  <Box
                    px="3"
                    py="2"
                    style={{
                      backgroundColor: color,
                      cursor: hasComment ? "pointer" : "default",
                    }}
                    onClick={() => hasComment && toggleCollapsed(item.id)}
                  >
                    <Flex justify="between" align="center">
                      <Text size="2" style={{ color: "white" }}>
                        {label}
                      </Text>
                      {hasComment && (
                        <PiCaretDown
                          size={10}
                          style={{
                            color: "white",
                            transform: isCollapsedItem ? "rotate(90deg)" : "none",
                            transition: "transform 0.2s",
                          }}
                        />
                      )}
                    </Flex>
                  </Box>
                  <Box px="3" py="2">
                    <Flex justify="between" align="center">
                      <Flex align="center" gap="2">
                        <UserAvatar
                          name={getUserDisplay(item.userId)}
                          size="sm"
                          variant="soft"
                        />
                        <Text size="2">{getUserDisplay(item.userId)}</Text>
                      </Flex>
                      <Text size="1" color="gray">
                        {ago(item.createdAt)}
                      </Text>
                    </Flex>
                    {!isCollapsedItem && hasComment && item.type === "review" && (
                      <Box mt="2" pl="4">
                        <Text size="2" color="gray">
                          {item.comment}
                        </Text>
                      </Box>
                    )}
                  </Box>
                </Card>
              );
            })}
          </Box>
        ))}
      </Box>
    </div>
  );
};

export default ApprovalFlowDetail;
