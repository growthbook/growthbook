import React from "react";
import { date } from "shared/dates";
import { FaCheck, FaTimes, FaComment, FaUser } from "react-icons/fa";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import { MetricInterface } from "back-end/types/metric";
import ApprovalFlowDiff from "./ApprovalFlowDiff";
import ApprovalFlowReview from "./ApprovalFlowReview";
import Button from "@/components/Button";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { GLOBAL_PERMISSIONS } from "shared/permissions";
import track from "@/services/track";

interface ApprovalFlowDetailsProps {
  approvalFlow: ApprovalFlowInterface;
  currentState: Record<string, unknown>;
  mutate: () => void;
}

const ApprovalFlowDetails: React.FC<ApprovalFlowDetailsProps> = ({
  approvalFlow,
  currentState,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const { userId, user } = useUser();
  const [merging, setMerging] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  //TODO: guy add canReview and canMerge based on the org settings for the entity type
  //default to true for now
  let canMerge = true;
  let canUserReview = true;
  // Check if current user is the author
  const isAuthor = userId === approvalFlow.author;
  
  // Check if user is admin (can approve their own changes)
  const isAdmin = user?.role === "admin";


  const handleMerge = async () => {
    setMerging(true);
      const result = await apiCall(`/approval-flow/${approvalFlow.id}/merge`, {
        method: "POST",
      });
      mutate();
      setMerging(false);
      track("Approval flow merged", { approvalFlowId: approvalFlow.id });

  };

  const handleClose = async () => {
    setClosing(true);
    await apiCall(`/approval-flow/${approvalFlow.id}/close`, {
      method: "POST",
    });
    
    mutate();
    track("Approval flow closed", { approvalFlowId: approvalFlow.id });
  };

  const handleReopen = async () => {
    
    setReopening(true);
      await apiCall(`/approval-flow/${approvalFlow.id}/reopen`, {
        method: "POST",
      });
      mutate();
      track("Approval flow reopened", { approvalFlowId: approvalFlow.id });
  };

  const getDecisionIcon = (decision: string) => {
    switch (decision) {
      case "approve":
        return <FaCheck className="text-success" />;
      case "request-changes":
        return <FaTimes className="text-danger" />;
      case "comment":
        return <FaComment className="text-muted" />;
      default:
        return null;
    }
  };

  const getDecisionText = (decision: string) => {
    switch (decision) {
      case "approve":
        return "approved";
      case "request-changes":
        return "requested changes";
      case "comment":
        return "commented";
      default:
        return decision;
    }
  };

  const canBeMerged =
    approvalFlow.status === "approved" &&
    canMerge &&
    !merging;

  return (
    <div className="approval-flow-details">
      {/* Header */}
      <div className="mb-4">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h4>{approvalFlow.title}</h4>
            {approvalFlow.description && (
              <p className="text-muted">{approvalFlow.description}</p>
            )}
          </div>
          
          {/* Action buttons for open approval flows */}
          {approvalFlow.status !== "merged" && approvalFlow.status !== "closed" && (
            <div className="d-flex gap-2">
              {canBeMerged && (
                <Button color="primary" onClick={handleMerge} disabled={merging || closing}>
                  {merging ? "Merging..." : "Merge Changes"}
                </Button>
              )}
              <Button 
                color="danger" 
                onClick={handleClose} 
                disabled={closing || merging}
                style={{ opacity: 0.8 }}
              >
                {closing ? "Closing..." : "Close"}
              </Button>
            </div>
          )}
          
          {/* Reopen button for closed approval flows */}
          {approvalFlow.status === "closed" && (
            <Button 
              color="secondary" 
              onClick={handleReopen} 
              disabled={reopening}
            >
              {reopening ? "Reopening..." : "Reopen"}
            </Button>
          )}
        </div>
      </div>

      {/* Diff Section */}
      <div className="mb-4">
        <ApprovalFlowDiff
          currentState={currentState}
          proposedChanges={approvalFlow.proposedChanges as Partial<MetricInterface>}
        />
      </div>

      {/* Reviews Section */}
      <div className="mb-4">
        <h5 className="mb-3">Reviews ({approvalFlow.reviews.length})</h5>
        {approvalFlow.reviews.length > 0 ? (
          <div className="list-group">
            {approvalFlow.reviews
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime()
              )
              .map((review) => (
                <div key={review.id} className="list-group-item">
                  <div className="d-flex gap-2 mb-2">
                    <div className="d-flex align-items-center gap-2">
                      {getDecisionIcon(review.decision)}
                      <strong>
                        <FaUser className="mr-1" />
                        {review.userId}
                      </strong>
                      <span className="text-muted">
                        {getDecisionText(review.decision)}
                      </span>
                      <span className="text-muted">•</span>
                      <span className="text-muted small">
                        {date(review.createdAt)}
                      </span>
                    </div>
                  </div>
                  {review.comment && (
                    <div className="pl-4">
                      <p className="mb-0">{review.comment}</p>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <p className="text-muted">No reviews yet</p>
        )}
      </div>

      {/* Add Review Section */}
      {approvalFlow.status !== "merged" && approvalFlow.status !== "closed" && (
        <>
          {isAuthor && !isAdmin && (
            <Box className="alert alert-info" mb="3">
              You created this approval flow. Only other users or admins can approve it.
            </Box>
          )}
          
          <ApprovalFlowReview
            approvalFlowId={approvalFlow.id}
            onReviewSubmitted={mutate}
            canReview={canUserReview}
          />
        </>
      )}

      {/* Activity Log */}
      <div className="mt-4">
        <h5 className="mb-3">Activity</h5>
        <div className="list-group">
          {approvalFlow.activityLog
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
            )
            .map((activity) => (
              <div key={activity.id} className="list-group-item">
                <div className="d-flex justify-content-between">
                  <div>
                    <strong>{activity.userId}</strong> {activity.action}
                    {activity.details && (
                      <span className="text-muted"> — {activity.details}</span>
                    )}
                  </div>
                  <span className="text-muted small">
                    {date(activity.createdAt)}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ApprovalFlowDetails;

