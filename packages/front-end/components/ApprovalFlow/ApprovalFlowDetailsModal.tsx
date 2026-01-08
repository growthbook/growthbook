import React, { useState, useEffect } from "react";
import { date } from "shared/dates";
import { FaCheck, FaTimes, FaComment, FaUser, FaShieldAlt, FaExclamationTriangle } from "react-icons/fa";
import {
  Box,
  Flex,
  Text,
  Separator,
  Badge,
  Card,
  Heading,
} from "@radix-ui/themes";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import { MergeResult } from "shared/util";
import { checkMergeConflicts } from "shared/util";
import ApprovalFlowDiff from "./ApprovalFlowDiff";
import ApprovalFlowReview from "./ApprovalFlowReview";
import MergeConflictResolver from "./MergeConflictResolver";
import Button from "@/ui/Button";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import useOrgSettings from "@/hooks/useOrgSettings";
import { canBypassApprovalFlow } from "@/services/approval-flow";
import { useDefinitions } from "@/services/DefinitionsContext";

interface ApprovalFlowDetailsModalProps {
  approvalFlow: ApprovalFlowInterface;
  currentState: Record<string, unknown>;
  onUpdate: () => void;
  onClose: () => void;
}

const ApprovalFlowDetailsModal: React.FC<ApprovalFlowDetailsModalProps> = ({
  approvalFlow,
  currentState,
  onUpdate,
  onClose,
}) => {
  const { apiCall } = useAuth();
  const userContext = useUser();
  const { userId, permissions } = userContext;
  const [merging, setMerging] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const reviewRef = React.useRef<{ submitReview: () => Promise<void> }>(null);
  const settings = useOrgSettings();
  const adminCanBypass = canBypassApprovalFlow(settings, approvalFlow, userContext);
  const { getMetricById, getFactMetricById, ready: definitionsReady } = useDefinitions();

  // Check for conflicts when modal opens for an approved flow
  useEffect(() => {
    const checkConflicts = () => {
      if (!definitionsReady) return;
      if (approvalFlow.status === "approved" || approvalFlow.status === "pending-review") {
        setCheckingConflicts(true);
        try {
          // Get the current live state of the entity
          let liveState: Record<string, unknown> | null = null;
          if (approvalFlow.entityType === "metric") {
            const currentMetric = getMetricById(approvalFlow.entityId);
            if (currentMetric) {
              liveState = currentMetric as unknown as Record<string, unknown>;
            }
          } else if (approvalFlow.entityType === "fact-metric") {
            const currentFactMetric = getFactMetricById(approvalFlow.entityId);
            if (currentFactMetric) {
              liveState = currentFactMetric as unknown as Record<string, unknown>;
            }
          }
          
          // If we have the live state, check for conflicts using the shared function
          if (liveState && approvalFlow.originalEntity && approvalFlow.proposedChanges) {
            const mergeResult = checkMergeConflicts(
              approvalFlow.originalEntity,
              liveState,
              approvalFlow.proposedChanges
            );
            
            if (!mergeResult.success) {
              setMergeResult(mergeResult);
            }
          }
        } catch (error) {
          console.error("Failed to check conflicts:", error);
        } finally {
          setCheckingConflicts(false);
        }
      }
    };
    checkConflicts();
  }, [approvalFlow.id, approvalFlow.status, approvalFlow.entityType, approvalFlow.entityId, approvalFlow.originalEntity, approvalFlow.proposedChanges, getMetricById, getFactMetricById, definitionsReady]);
  // Check if current user is the author
  const isAuthor = userId === approvalFlow.author;

  //todo:  do proper admin check

  // Users cannot review their own approval flow (like GitHub PRs)
  // Exception: admins can review their own if adminCanBypass is enabled
  const canUserReview = !isAuthor;

  const handleMerge = async (bypassApproval = false) => {
    // If there are conflicts, show the resolver
    if (mergeResult && !mergeResult.success) {
      setShowConflictResolver(true);
      return;
    }

    setMerging(true);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ bypassApproval }),
      });

      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to merge:", error);
    } finally {
      setMerging(false);
    }
  };

  const handleConflictsResolved = () => {
    setShowConflictResolver(false);
    setMergeResult(null);
    onUpdate();
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/close`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to close:", error);
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    setReopening(true);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/reopen`, {
        method: "POST",
      });

      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to reopen:", error);
    } finally {
      setReopening(false);
    }
  };

  const canBeMerged = approvalFlow.status === "approved";
  const isOpen =
    approvalFlow.status !== "merged" && approvalFlow.status !== "closed";
  const isClosed = approvalFlow.status === "closed";
  const needsApproval =
    approvalFlow.status === "pending-review" ||
    approvalFlow.status === "changes-requested" ||
    approvalFlow.status === "draft";

  const handleSubmitReview = async () => {
    if (reviewRef.current) {
      await reviewRef.current.submitReview();
    }
  };

  // Determine primary CTA
  let primaryCTA: string | null = null;
  let primaryCTAHandler: (() => void | Promise<void>) | undefined = undefined;
  let primaryCTADisabled = false;

  if (canBeMerged) {
    // If approved, primary action is to merge
    primaryCTA = merging ? "Merging..." : "Merge Changes";
    primaryCTAHandler = () => handleMerge(false);
    primaryCTADisabled = merging;
  } else if (isOpen && canUserReview) {
    // If open and user can review, primary action is to submit review
    primaryCTA = submittingReview ? "Submitting..." : "Submit Review";
    primaryCTAHandler = handleSubmitReview;
    primaryCTADisabled = submittingReview;
  }

  return (
    <>
    <Modal
      open={true}
      close={onClose}
      size="max"
      header={
        <Flex align="center" gap="3">
          <Text size="5" weight="bold">
            {approvalFlow.title}
          </Text>
        </Flex>
      }
      trackingEventModalType={`approval-flow-details-${approvalFlow.entityType}`}
      cta={primaryCTA}
      submit={primaryCTAHandler}
      ctaEnabled={!primaryCTADisabled}
      secondaryCTA={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
      tertiaryCTA={null}
      showHeaderCloseButton={false}
      includeCloseCta={false}
    >
      <Box>
        {/* Description */}
        {approvalFlow.description && (
          <Box mb="4">
            <Text color="gray" size="2">
              {approvalFlow.description}
            </Text>
          </Box>
        )}

        {/* Conflict Warning */}
        {mergeResult && !mergeResult.success && (
          <Box mb="4">
            <Card
              size="2"
              style={{
                backgroundColor: "var(--amber-2)",
                border: "1px solid var(--amber-6)",
              }}
            >
              <Flex align="center" gap="3">
                <FaExclamationTriangle
                  size={20}
                  style={{ color: "var(--amber-9)" }}
                />
                <Box style={{ flex: 1 }}>
                  <Text size="2" weight="medium" as="p">
                    Merge Conflicts Detected
                  </Text>
                  <Text size="1" color="gray">
                    {mergeResult.conflicts.length} field
                    {mergeResult.conflicts.length !== 1 ? "s have" : " has"}{" "}
                    been modified since this approval flow was created.
                  </Text>
                </Box>
                {isAuthor && (
                  <Button
                    variant="soft"
                    color="violet"
                    onClick={() => setShowConflictResolver(true)}
                  >
                    Resolve Conflicts
                  </Button>
                )}
              </Flex>
            </Card>
          </Box>
        )}

        {/* Proposed Changes Section */}
        <Box mb="5">
          <Heading size="4" mb="3" weight="medium">
            Proposed Changes
          </Heading>
          <ApprovalFlowDiff
            currentState={currentState}
            proposedChanges={approvalFlow.proposedChanges}
          />
        </Box>

        <Separator size="4" mb="5" />

        {/* Combined Reviews and Activity Section */}
        <Box mb="5">
          <Heading size="4" mb="3" weight="medium">
            Activity & Reviews
          </Heading>

          {approvalFlow.reviews.length > 0 || approvalFlow.activityLog.length > 0 ? (
            <Flex direction="column" gap="2">
              {[
                ...approvalFlow.reviews.map((review) => ({
                  type: "review" as const,
                  id: review.id,
                  userId: review.userId,
                  createdAt: review.createdAt,
                  decision: review.decision,
                  comment: review.comment,
                })),
                ...approvalFlow.activityLog
                  .filter(
                    (activity) =>
                      !["reviewed", "approved", "requested-changes", "commented"].includes(
                        activity.action
                      )
                  )
                  .map((activity) => ({
                    type: "activity" as const,
                    id: activity.id,
                    userId: activity.userId,
                    createdAt: activity.createdAt,
                    action: activity.action,
                    details: activity.details,
                  })),
              ]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime()
                )
                .map((item) => (
                  <Card key={`${item.type}-${item.id}`} size="2">
                    <Flex justify="between" align="start" mb={item.type === "review" && item.comment ? "2" : "0"}>
                      <Flex gap="2" align="center" style={{ flex: 1 }}>
                        <Box
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            backgroundColor: "var(--gray-4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {item.type === "review" ? (
                            item.decision === "approve" ? (
                              <FaCheck size={12} style={{ color: "var(--green-9)" }} />
                            ) : item.decision === "request-changes" ? (
                              <FaTimes size={12} style={{ color: "var(--orange-9)" }} />
                            ) : (
                              <FaComment size={12} style={{ color: "var(--gray-9)" }} />
                            )
                          ) : (
                            <FaUser size={12} style={{ color: "var(--gray-9)" }} />
                          )}
                        </Box>
                        <Box style={{ flex: 1 }}>
                          <Flex gap="2" align="center" wrap="wrap">
                            <Text weight="medium" size="2">
                              {item.userId}
                            </Text>
                            {item.type === "review" ? (
                              <>
                                <Text size="2" color="gray">
                                  {item.decision === "approve"
                                    ? "approved"
                                    : item.decision === "request-changes"
                                    ? "requested changes"
                                    : "commented"}
                                </Text>
                                {item.decision === "approve" && (
                                  <Badge color="green" size="1">
                                    Approved
                                  </Badge>
                                )}
                                {item.decision === "request-changes" && (
                                  <Badge color="orange" size="1">
                                    Changes Requested
                                  </Badge>
                                )}
                                {item.decision === "comment" && (
                                  <Badge color="gray" size="1" variant="soft">
                                    Comment
                                  </Badge>
                                )}
                              </>
                            ) : (
                              <Text size="2" color="gray">
                                {item.action}
                                {item.details && ` — ${item.details}`}
                              </Text>
                            )}
                          </Flex>
                        </Box>
                      </Flex>
                      <Text size="1" color="gray" style={{ marginLeft: "8px" }}>
                        {date(item.createdAt)}
                      </Text>
                    </Flex>
                    {item.type === "review" && item.comment && (
                      <Box
                        pl="5"
                        style={{
                          marginLeft: 14,
                          borderLeft: "2px solid var(--gray-4)",
                        }}
                      >
                        <Text size="2">{item.comment}</Text>
                      </Box>
                    )}
                  </Card>
                ))}
            </Flex>
          ) : (
            <Box
              p="4"
              style={{
                backgroundColor: "var(--gray-2)",
                borderRadius: "var(--radius-2)",
                textAlign: "center",
              }}
            >
              <Text size="2" color="gray">
                No activity yet.
              </Text>
            </Box>
          )}
        </Box>

        {/* Add Review Section */}
        {isOpen && (
          <>
            <Separator size="4" mb="5" />

            {isAuthor && (
              <Callout status="info" mb="4">
                You created this approval flow. You cannot review your own
                changes.
              </Callout>
            )}

            {canUserReview && (
              <ApprovalFlowReview
                ref={reviewRef}
                approvalFlowId={approvalFlow.id}
                onReviewSubmitted={() => {
                  onUpdate();
                }}
                canReview={canUserReview}
                onSubmittingChange={setSubmittingReview}
              />
            )}

            {/* Admin Bypass Section */}
            {adminCanBypass && needsApproval && (
              <Box mt="6">
                <Separator size="4" mb="4" />
                <Card
                  size="2"
                  style={{
                    backgroundColor: "var(--amber-2)",
                    border: "1px solid var(--amber-6)",
                  }}
                >
                  <Flex justify="between" align="center">
                    <Flex gap="3" align="center">
                      <Box
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          backgroundColor: "var(--amber-4)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <FaShieldAlt
                          size={16}
                          style={{ color: "var(--amber-11)" }}
                        />
                      </Box>
                      <Box>
                        <Text size="2" weight="medium">
                          Admin Override
                        </Text>
                        <Text size="1" color="gray">
                          Merge without approval (admin only)
                        </Text>
                      </Box>
                    </Flex>
                    <Button
                      color="violet"
                      variant="soft"
                      onClick={() => handleMerge(true)}
                      disabled={merging || closing || submittingReview}
                      loading={merging}
                    >
                      Merge Without Approval
                    </Button>
                  </Flex>
                </Card>
              </Box>
            )}

            {/* Close Approval Flow button */}
            <Box mt="6">
              <Separator size="4" mb="4" />
              <Flex justify="between" align="center">
                <Box>
                  <Text size="2" weight="medium">
                    Close without merging
                  </Text>
                  <Text size="1" color="gray">
                    This will discard the proposed changes
                  </Text>
                </Box>
                <Button
                  color="red"
                  variant="soft"
                  onClick={handleClose}
                  disabled={closing || merging || submittingReview}
                  loading={closing}
                >
                  Close Request
                </Button>
              </Flex>
            </Box>
          </>
        )}

        {/* Reopen Section */}
        {isClosed && (
          <Box mt="5">
            <Separator size="4" mb="4" />
            <Flex justify="between" align="center">
              <Box>
                <Text size="2" weight="medium">
                  Reopen this request
                </Text>
                <Text size="1" color="gray">
                  Continue reviewing the proposed changes
                </Text>
              </Box>
              <Button
                variant="soft"
                onClick={handleReopen}
                disabled={reopening}
                loading={reopening}
              >
                Reopen
              </Button>
            </Flex>
          </Box>
        )}

      </Box>
    </Modal>

    {/* Merge Conflict Resolver Modal */}
    {showConflictResolver && mergeResult && (
      <MergeConflictResolver
        approvalFlowId={approvalFlow.id}
        mergeResult={mergeResult}
        currentState={currentState}
        onResolved={handleConflictsResolved}
        onCancel={() => setShowConflictResolver(false)}
      />
    )}
  </>
  );
};

export default ApprovalFlowDetailsModal;
