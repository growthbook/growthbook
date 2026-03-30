import React, { useEffect, useState } from "react";
import { Box, Flex, Popover } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { date, ago } from "shared/dates";
import {
  Revision,
  checkMergeConflicts,
  MergeResult,
  applyTopLevelPatchOps,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Button from "@/ui/Button";
import RadioGroup from "@/ui/RadioGroup";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import Modal from "@/components/Modal";
import Tooltip from "@/ui/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Checkbox from "@/ui/Checkbox";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import FixRevisionConflictsModal from "./FixRevisionConflictsModal";
import { getStatusBadge } from "./revisionUtils";
import { RevisionDiff } from "./RevisionDiff";

interface RevisionDetailProps<T> {
  revision: Revision;
  currentState: Revision["target"]["snapshot"];
  mutate?: () => void;
  setCurrentRevision: (revision: Revision | null) => void;
  onPublish: (revisionId: string) => Promise<void>;
  onReopen?: (revisionId: string) => Promise<void>;
  diffConfig: RevisionDiffConfig<T>;
  allRevisions?: Revision[];
  requiresApproval?: boolean;
  closeModal?: () => void;
}

function RevisionDetail<T>({
  revision,
  currentState,
  mutate,
  setCurrentRevision,
  onPublish,
  onReopen,
  diffConfig,
  allRevisions = [],
  requiresApproval = true,
  closeModal,
}: RevisionDetailProps<T>) {
  const { getUserDisplay, userId, user } = useUser();
  const { apiCall } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [bypassApproval, setBypassApproval] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [showFixConflicts, setShowFixConflicts] = useState(false);
  const [reviewDropdownOpen, setReviewDropdownOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] = useState<
    "approve" | "request-changes" | "comment"
  >("comment");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(revision.title || "");
  const permissionsUtil = usePermissionsUtil();

  // Update titleInput when revision changes
  useEffect(() => {
    setTitleInput(revision.title || "");
  }, [revision.id, revision.title]);

  useEffect(() => {
    if (
      !revision.target.snapshot ||
      !revision.target.proposedChanges ||
      !currentState
    ) {
      setMergeResult(null);
      return;
    }
    const result = checkMergeConflicts(
      revision.target.snapshot as unknown as Record<string, unknown>,
      currentState as unknown as Record<string, unknown>,
      revision.target.proposedChanges,
    );
    setMergeResult(result);
  }, [
    revision.id,
    revision.target.snapshot,
    revision.target.proposedChanges,
    currentState,
  ]);
  // Group activity by date

  const allActivity = [
    ...revision.reviews.map((r) => ({
      type: "review" as const,
      id: r.id,
      userId: r.userId,
      createdAt: r.dateCreated,
      decision: r.decision,
      details: r.comment,
    })),
    ...revision.activityLog
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
    revision.status !== "merged" && revision.status !== "discarded";

  const handleSaveTitle = async () => {
    if (!titleInput.trim() || titleInput === revision.title) {
      setIsEditingTitle(false);
      setTitleInput(revision.title || "");
      return;
    }

    try {
      const res = await apiCall<{ revision: Revision }>(
        `/revision/${revision.id}/title`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: titleInput.trim() }),
        },
      );
      if (res?.revision) {
        setCurrentRevision(res.revision);
        if (mutate) mutate();
      }
      setIsEditingTitle(false);
    } catch (err) {
      console.error("Failed to update title:", err);
      setTitleInput(revision.title || "");
      setIsEditingTitle(false);
    }
  };

  const canUserReview =
    !!userId &&
    permissionsUtil.canUpdateSavedGroup(
      currentState as SavedGroupInterface,
      {},
    );
  const isRevisionAuthor = !!userId && revision.authorId === userId;
  const approveOwnChangesMessage =
    "You cannot approve your own proposed changes.";
  const requestOwnChangesMessage =
    "You cannot request changes on your own proposed changes.";

  useEffect(() => {
    if (isRevisionAuthor && reviewDecision !== "comment") {
      setReviewDecision("comment");
    }
  }, [isRevisionAuthor, reviewDecision]);

  // Handle submitting a review
  const handleSubmitForReview = async () => {
    setIsSubmitting(true);
    setReviewError(null);
    try {
      const response = await apiCall<{ revision: Revision }>(
        `/revision/${revision.id}/submit`,
        {
          method: "POST",
        },
      );

      // Update the current revision with the response
      if (response.revision) {
        setCurrentRevision(response.revision);
      }
      mutate?.();
      closeModal?.();
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "Failed to submit for review",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReview = async (
    decision: "approve" | "request-changes" | "comment",
    reviewCommentText: string,
  ) => {
    if (isRevisionAuthor && decision !== "comment") {
      setReviewError(
        decision === "approve"
          ? approveOwnChangesMessage
          : requestOwnChangesMessage,
      );
      return;
    }

    setIsSubmitting(true);
    setReviewError(null);
    try {
      const response = await apiCall<{ revision: Revision }>(
        `/revision/${revision.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            comment: reviewCommentText,
          }),
        },
      );

      // Update the current revision with the response
      if (response.revision) {
        setCurrentRevision(response.revision);
      }

      // Also refresh the list in the background
      mutate?.();

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

  // Prepare diff data
  const baseSnapshot =
    revision.status === "merged"
      ? (revision.target.snapshot as T)
      : (currentState as T);

  const proposedSnapshot = applyTopLevelPatchOps(
    baseSnapshot as Record<string, unknown>,
    revision.target.proposedChanges,
  ) as T;

  // Use custom hook to compute diffs
  const { diffs, badges, customRenderGroups } = useRevisionDiff<T>(
    baseSnapshot,
    proposedSnapshot,
    diffConfig,
  );

  const handleMerge = async () => {
    setIsSubmitting(true);
    setMergeError(null);
    try {
      await onPublish(revision.id);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Failed to merge");
    } finally {
      setIsSubmitting(false);
    }
  };

  const savedGroupProjects = (currentState as SavedGroupInterface).projects;
  const canBypass =
    isOpen &&
    (user?.role === "admin" ||
      (savedGroupProjects?.length
        ? savedGroupProjects.every((project) =>
            permissionsUtil.canBypassApprovalChecks({ project: project || "" }),
          )
        : permissionsUtil.canBypassApprovalChecks({ project: "" })));

  const canMerge = (): boolean => {
    if (!isOpen) return false;
    if (!!mergeResult && !mergeResult.success) return false;
    // Don't allow publishing if there are no changes
    if (diffs.length === 0) return false;
    // If approval is not required, allow publishing drafts directly
    if (!requiresApproval) {
      return permissionsUtil.canUpdateSavedGroup(
        currentState as SavedGroupInterface,
        {},
      );
    }
    // If approval is required, check for approval or bypass
    if (revision.status !== "approved" && !bypassApproval) return false;
    return permissionsUtil.canUpdateSavedGroup(
      currentState as SavedGroupInterface,
      {},
    );
  };

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
      case "discarded":
        return {
          label: "Discarded",
          junctionCopy: "by",
          color: "var(--red-7)",
        };
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
      {confirmPublish && (
        <Modal
          trackingEventModalType=""
          header="Publish Changes"
          close={() => setConfirmPublish(false)}
          open={true}
          dismissible
          cta="Publish"
          submitColor="primary"
          submit={handleMerge}
        >
          These changes will go live immediately. Are you sure you want to
          publish?
        </Modal>
      )}
      {confirmReopen && onReopen && (
        <Modal
          trackingEventModalType=""
          header="Reopen Revision"
          close={() => setConfirmReopen(false)}
          open={true}
          dismissible
          cta="Reopen"
          submitColor="primary"
          submit={async () => {
            await onReopen(revision.id);
            setConfirmReopen(false);
          }}
        >
          This will reopen the revision and allow you to make further changes or
          request review again.
        </Modal>
      )}
      {showFixConflicts && mergeResult && !mergeResult.success && (
        <FixRevisionConflictsModal
          revision={revision}
          currentState={currentState as Record<string, unknown>}
          close={() => setShowFixConflicts(false)}
          mutate={() => {
            setShowFixConflicts(false);
            mutate?.();
          }}
        />
      )}
      {mergeResult && !mergeResult.success && (
        <Callout status="error" mb="4">
          <Flex justify="between" align="center">
            <Text size="medium">
              You have conflicts with the current state of the entity. Please
              resolve the conflicts before merging.
            </Text>
            <Button onClick={() => setShowFixConflicts(true)} variant="outline">
              Fix Conflicts
            </Button>
          </Flex>
        </Callout>
      )}
      {mergeError && (
        <Callout status="error" mb="4">
          <Text size="medium">{mergeError}</Text>
        </Callout>
      )}
      {revision.status === "merged" && (
        <Callout status="success" mb="4">
          <Flex justify="between" align="center">
            <Text size="medium">
              This revision has been merged and published.
            </Text>
          </Flex>
        </Callout>
      )}
      {revision.status === "discarded" && (
        <Callout status="warning" mb="4">
          <Flex justify="between" align="center">
            <Text size="medium">This revision has been discarded.</Text>
            {onReopen && (
              <Button
                variant="solid"
                color="violet"
                size="sm"
                onClick={() => setConfirmReopen(true)}
              >
                Reopen
              </Button>
            )}
          </Flex>
        </Callout>
      )}

      {canBypass && requiresApproval && isOpen && (
        <Box mt="3" mb="4" ml="1">
          <Checkbox
            label="Bypass approval requirement to publish (optional for Admins only)"
            value={bypassApproval}
            setValue={(val) => setBypassApproval(!!val)}
          />
        </Box>
      )}

      {(revision.title || isEditingTitle || (isRevisionAuthor && isOpen)) && (
        <Box mb="2">
          {isEditingTitle ? (
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSaveTitle();
                } else if (e.key === "Escape") {
                  setIsEditingTitle(false);
                  setTitleInput(revision.title || "");
                }
              }}
              autoFocus
              placeholder="Add a title to this revision (optional)"
              style={{
                fontSize: "1.5rem",
                fontWeight: 600,
                border: "1px solid var(--gray-6)",
                borderRadius: "var(--radius-2)",
                padding: "4px 8px",
                width: "100%",
                maxWidth: "500px",
              }}
            />
          ) : (
            <Flex align="center" gap="2">
              <Heading as="h3">{revision.title}</Heading>
              {isRevisionAuthor && isOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingTitle(true)}
                  style={{ padding: "4px" }}
                >
                  Edit
                </Button>
              )}
            </Flex>
          )}
        </Box>
      )}
      {reviewError && revision.status === "draft" && requiresApproval && (
        <Callout status="error" mb="3">
          {reviewError}
        </Callout>
      )}
      <Flex justify="between" align="center" mb="4">
        <Flex align="center" gap="2">
          <UserAvatar
            name={getUserDisplay(revision.authorId)}
            size="sm"
            variant="soft"
          />
          <Text size="large" weight="medium">
            {`${getUserDisplay(revision.authorId)} on ${date(revision.dateCreated)}`}
          </Text>
          {getStatusBadge(revision.status, requiresApproval)}
        </Flex>
        <Flex gap="2">
          {revision.status === "draft" ? (
            // For drafts: show either "Request Approval" or "Publish" based on approval requirement
            requiresApproval ? (
              <>
                <Tooltip
                  content={
                    diffs.length === 0 ? "No changes to submit" : undefined
                  }
                  enabled={diffs.length === 0}
                >
                  <span style={{ display: "inline-block" }}>
                    <Button
                      variant="solid"
                      color="violet"
                      onClick={handleSubmitForReview}
                      disabled={isSubmitting || diffs.length === 0}
                      style={
                        diffs.length === 0
                          ? { pointerEvents: "none" }
                          : undefined
                      }
                    >
                      {isSubmitting ? "Submitting..." : "Request Approval"}
                    </Button>
                  </span>
                </Tooltip>
                {bypassApproval && (
                  <Tooltip
                    content={
                      diffs.length === 0 ? "No changes to publish" : undefined
                    }
                    enabled={!canMerge() && !isSubmitting}
                  >
                    <span style={{ display: "inline-block" }}>
                      <Button
                        variant="solid"
                        color="violet"
                        onClick={handleMerge}
                        disabled={isSubmitting || !canMerge()}
                        style={
                          !canMerge() ? { pointerEvents: "none" } : undefined
                        }
                      >
                        Publish
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </>
            ) : (
              <Tooltip
                content={
                  diffs.length === 0 ? "No changes to publish" : undefined
                }
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
            )
          ) : (
            // For non-drafts: show review button and publish button
            <>
              <Popover.Root
                open={reviewDropdownOpen}
                onOpenChange={setReviewDropdownOpen}
              >
                <Popover.Trigger>
                  <Button
                    variant="solid"
                    preventDefault={false}
                    disabled={
                      revision.status === "discarded" ||
                      revision.status === "merged"
                    }
                  >
                    {requiresApproval ? "Submit review" : "Add comment"}{" "}
                    <PiCaretDown style={{ marginLeft: "4px" }} />
                  </Button>
                </Popover.Trigger>
                <Popover.Content width="320px" size="2" align="end">
                  <Text size="medium" weight="medium" mb="2" as="p">
                    Leave a comment
                  </Text>
                  <Field
                    textarea
                    minRows={2}
                    placeholder={
                      requiresApproval
                        ? "Add your review comment..."
                        : "Add a comment..."
                    }
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                  />
                  {requiresApproval && (
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
                          },
                          {
                            value: "request-changes",
                            label: "Request Changes",
                            description:
                              "Submit feedback that must be addressed",
                            disabled: isRevisionAuthor,
                            disabledReason: requestOwnChangesMessage,
                          },
                          {
                            value: "approve",
                            label: "Approve",
                            description: "Approve and allow merging",
                            disabled: isRevisionAuthor,
                            disabledReason: approveOwnChangesMessage,
                          },
                        ]}
                      />
                    </Box>
                  )}
                  {requiresApproval && !canUserReview && (
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
                      onClick={() => {
                        handleSubmitReview(
                          requiresApproval ? reviewDecision : "comment",
                          reviewComment,
                        );
                      }}
                      disabled={isSubmitting || !reviewComment.trim()}
                    >
                      {isSubmitting ? "Submitting..." : "Confirm"}
                    </Button>
                  </Flex>
                </Popover.Content>
              </Popover.Root>
              <Tooltip
                content={
                  diffs.length === 0
                    ? "No changes to publish"
                    : requiresApproval
                      ? bypassApproval
                        ? undefined
                        : "Approval is required before publishing"
                      : undefined
                }
                enabled={!canMerge() && !isSubmitting}
              >
                <span style={{ display: "inline-block" }}>
                  <Button
                    variant="solid"
                    color="violet"
                    onClick={() =>
                      bypassApproval ? handleMerge() : setConfirmPublish(true)
                    }
                    disabled={isSubmitting || !canMerge()}
                    style={!canMerge() ? { pointerEvents: "none" } : undefined}
                  >
                    Publish
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </Flex>
      </Flex>

      <RevisionDiff
        diffs={diffs}
        badges={badges}
        customRenderGroups={customRenderGroups}
      />

      {/* Comments Section */}
      <Box mb="4">
        <Text size="large" weight="medium">
          Comments ({revision.reviews.length})
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
                        {`${ago(item.createdAt)}`}
                      </Text>
                    </Flex>

                    {hasComment && (
                      <Text size="medium">
                        {/* Check if this is a revert description with a revision number */}
                        {item.details?.includes(
                          "reverts changes from Revision",
                        ) && revision.revertedFrom ? (
                          <>
                            This revision reverts changes from{" "}
                            <Link
                              onClick={(e) => {
                                e.preventDefault();
                                if (revision.revertedFrom) {
                                  const revertedRevision = (
                                    allRevisions || []
                                  ).find((r) => r.id === revision.revertedFrom);
                                  if (revertedRevision) {
                                    setCurrentRevision(revertedRevision);
                                  }
                                }
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {(allRevisions || []).find(
                                (r) => r.id === revision.revertedFrom,
                              )?.title ||
                                item.details?.match(/Revision (\d+)/)?.[0] ||
                                "that revision"}
                            </Link>
                          </>
                        ) : (
                          item.details
                        )}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default RevisionDetail;
