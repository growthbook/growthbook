import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import {
  FaCheck,
  FaTimes,
  FaComment,
  FaUser,
  FaShieldAlt,
  FaExclamationTriangle,
  FaArrowLeft,
} from "react-icons/fa";
import {
  Box,
  Flex,
  Text,
  Separator,
  Badge,
  Card,
  Heading,
} from "@radix-ui/themes";
import { MergeResult, checkMergeConflicts } from "shared/util";
import ApprovalFlowDiff from "@/components/ApprovalFlow/ApprovalFlowDiff";
import ApprovalFlowReview from "@/components/ApprovalFlow/ApprovalFlowReview";
import MergeConflictResolver from "@/components/ApprovalFlow/MergeConflictResolver";
import ApprovalFlowSQLPreview from "@/components/ApprovalFlow/ApprovalFlowSQLPreview";
import Button from "@/ui/Button";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import useOrgSettings from "@/hooks/useOrgSettings";
import { canBypassApprovalFlow } from "@/services/approval-flow";
import { useApprovalFlow } from "@/hooks/useApprovalFlows";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Link from "next/link";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useApprovalFlowSQL } from "@/hooks/useApprovalFlowSQL";

const ApprovalFlowPage: React.FC = () => {
  const router = useRouter();
  const { aid } = router.query;
  const { apiCall } = useAuth();
  const userContext = useUser();
  const { userId } = userContext;
  const [merging, setMerging] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [currentState, setCurrentState] = useState<Record<string, unknown>>({});
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const reviewRef = React.useRef<{ submitReview: () => Promise<void> }>(null);
  
  const { approvalFlow, isLoading, mutate } = useApprovalFlow(aid as string);
  const settings = useOrgSettings();
  const { getMetricById, getFactMetricById, getFactTableById, ready: definitionsReady } = useDefinitions();
  
  const adminCanBypass = approvalFlow ? canBypassApprovalFlow(settings, approvalFlow, userContext) : false;
  // Check for conflicts when page loads for an approved flow
  useEffect(() => {
    const checkConflicts = () => {
      if (!approvalFlow || !definitionsReady) return;
      
      // Always use originalEntity as the base state
      // This is the entity state when the approval flow was created
      if (approvalFlow.originalEntity) {
        setCurrentState(approvalFlow.originalEntity);
      }
      
      // Check for conflicts if the flow is approved or pending review
      if (approvalFlow.status === "approved" || approvalFlow.status === "pending-review") {
        setCheckingConflicts(true);
        try {
          // Get the current live state of the entity
          let liveState: Record<string, unknown> | null = null;
          if (approvalFlow.entityType === "fact-metric") {
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
  }, [approvalFlow?.id, approvalFlow?.status, approvalFlow?.originalEntity, approvalFlow?.entityType, approvalFlow?.entityId, approvalFlow?.proposedChanges, getMetricById, getFactMetricById, definitionsReady]);

  // Get SQL preview data for fact metrics (must be before early returns)
  const {
    currentSql,
    proposedSql,
    currentDenominatorSQL,
    proposedDenominatorSQL,
    hasSql,
    sqlChanged,
  } = useApprovalFlowSQL(
    approvalFlow?.entityType,
    currentState,
    approvalFlow?.proposedChanges,
    getFactTableById
  );

  if (isLoading || !aid) {
    return <LoadingOverlay />;
  }

  if (!approvalFlow) {
    return (
      <div className="container-fluid pagecontents">
        <div className="alert alert-danger">
          Could not find the requested approval flow.{" "}
          <Link href="/metrics">Back to metrics</Link>
        </div>
      </div>
    );
  }

  // Check if current user is the author
  const isAuthor = userId === approvalFlow.author;

  // Users cannot review their own approval flow (like GitHub PRs)
  // Exception: admins can review their own if adminCanBypass is enabled
  const canUserReview = !isAuthor;

  const handleMerge = async (bypassApproval = false) => {
    if (!approvalFlow) return;
    
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

      mutate();
    } catch (error) {
      console.error("Failed to merge:", error);
    } finally {
      setMerging(false);
    }
  };

  const handleConflictsResolved = () => {
    setShowConflictResolver(false);
    setMergeResult(null);
    mutate();
  };

  const handleClose = async () => {
    if (!approvalFlow) return;
    
    setClosing(true);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/close`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      mutate();
    } catch (error) {
      console.error("Failed to close:", error);
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!approvalFlow) return;
    
    setReopening(true);
    try {
      await apiCall(`/approval-flow/${approvalFlow.id}/reopen`, {
        method: "POST",
      });

      mutate();
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

  const breadcrumb = {
    "fact-metric": [
      { display: "Metrics", href: `/metrics#approvalflows`},
      { display: `${approvalFlow.title} - Approval Flow`},
    ],
    "fact-table": [
      { display: "Fact Tables", href: `/fact-tables`},
      { display: `${approvalFlow.title} - Approval Flow`},
    ]

  }
  return (
    <>
      <PageHead
        breadcrumb={
          breadcrumb[approvalFlow.entityType]
        }
      />
      <div className="container-fluid pagecontents">
        <Box mb="4">
          <Flex align="center" gap="3" mb="4">
            <Heading size="6" weight="bold">
              {approvalFlow.title}
            </Heading>
            {canBeMerged && (
              <Button
                color="violet"
                onClick={() => handleMerge(false)}
                disabled={merging || closing || submittingReview}
                loading={merging}
              >
                Merge Changes
              </Button>
            )}
            {isOpen && canUserReview && (
              <Button
                color="violet"
                onClick={handleSubmitReview}
                disabled={submittingReview}
                loading={submittingReview}
              >
                Submit Review
              </Button>
            )}
          </Flex>

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
            <Flex gap="4" direction={{ initial: "column", lg: "row" }} align="start">
              <Box style={{ flex: 1, minWidth: 0 }}>
                <ApprovalFlowDiff
                  currentState={currentState}
                  proposedChanges={approvalFlow.proposedChanges}
                />
              </Box>
              
              {/* SQL Display - Show for metrics and fact-metrics with SQL */}
              {(approvalFlow.entityType === "metric" ||
                approvalFlow.entityType === "fact-metric") &&
                hasSql && (
                <ApprovalFlowSQLPreview
                  currentSql={currentSql}
                  proposedSql={proposedSql}
                  currentDenominatorSQL={currentDenominatorSQL}
                  proposedDenominatorSQL={proposedDenominatorSQL}
                  sqlChanged={sqlChanged}
                  isFactMetric={approvalFlow.entityType === "fact-metric"}
                />
              )}
            </Flex>
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
                    mutate();
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
      </div>

      {/* Merge Conflict Resolver Modal */}
      {true && mergeResult && approvalFlow && (
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

export default ApprovalFlowPage;
