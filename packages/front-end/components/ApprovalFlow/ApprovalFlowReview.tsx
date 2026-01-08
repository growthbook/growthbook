import React, { useState, forwardRef, useImperativeHandle } from "react";
import { Box, Flex, Text, TextArea, Card } from "@radix-ui/themes";
import { FaCheck, FaTimes, FaComment } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useForm } from "react-hook-form";
import Callout from "@/ui/Callout";

interface ApprovalFlowReviewProps {
  approvalFlowId: string;
  onReviewSubmitted: () => void;
  canReview: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
}

export interface ApprovalFlowReviewRef {
  submitReview: () => Promise<void>;
}

type ReviewDecision = "approve" | "request-changes" | "comment";

const ApprovalFlowReview = forwardRef<
  ApprovalFlowReviewRef,
  ApprovalFlowReviewProps
>(({ approvalFlowId, onReviewSubmitted, canReview, onSubmittingChange }, ref) => {
  const { apiCall } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState<ReviewDecision>("comment");

  const form = useForm({
    defaultValues: {
      comment: "",
    },
  });

  const submitReview = async () => {
    if (submitting) return;

    const comment = form.watch("comment");
    if (!comment.trim()) {
      return;
    }

    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      await apiCall(`/approval-flow/${approvalFlowId}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment,
        }),
      });

      form.reset();
      setDecision("comment");
      onReviewSubmitted();
    } catch (error) {
      console.error("Failed to submit review:", error);
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  // Expose submitReview method to parent via ref
  useImperativeHandle(ref, () => ({
    submitReview,
  }));

  if (!canReview) {
    return (
      <Callout status="info">
        You don&apos;t have permission to review this approval flow.
      </Callout>
    );
  }

  const reviewOptions: {
    value: ReviewDecision;
    label: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    borderColor: string;
  }[] = [
    {
      value: "comment",
      label: "Comment",
      icon: <FaComment size={14} />,
      color: "var(--gray-11)",
      bgColor: "var(--gray-3)",
      borderColor: "var(--gray-7)",
    },
    {
      value: "approve",
      label: "Approve",
      icon: <FaCheck size={14} />,
      color: "var(--green-11)",
      bgColor: "var(--green-3)",
      borderColor: "var(--green-7)",
    },
    {
      value: "request-changes",
      label: "Request Changes",
      icon: <FaTimes size={14} />,
      color: "var(--orange-11)",
      bgColor: "var(--orange-3)",
      borderColor: "var(--orange-7)",
    },
  ];

  return (
    <Box>
      <Text size="4" weight="medium" mb="3" as="p">
        Add Your Review
      </Text>

      <Card size="2">
        <Box mb="4">
          <Text size="2" weight="medium" mb="2" as="p">
            Review Type
          </Text>
          <Flex gap="2">
            {reviewOptions.map((option) => (
              <Box
                key={option.value}
                onClick={() => setDecision(option.value)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-2)",
                  border: `2px solid ${
                    decision === option.value
                      ? option.borderColor
                      : "var(--gray-5)"
                  }`,
                  backgroundColor:
                    decision === option.value ? option.bgColor : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Flex align="center" gap="2">
                  <span
                    style={{
                      color:
                        decision === option.value
                          ? option.color
                          : "var(--gray-9)",
                    }}
                  >
                    {option.icon}
                  </span>
                  <Text
                    size="2"
                    weight={decision === option.value ? "medium" : "regular"}
                    style={{
                      color:
                        decision === option.value
                          ? option.color
                          : "var(--gray-11)",
                    }}
                  >
                    {option.label}
                  </Text>
                </Flex>
              </Box>
            ))}
          </Flex>
        </Box>

        <Box>
          <Text size="2" weight="medium" mb="2" as="p">
            Comment{" "}
            <Text color="gray" weight="regular">
              (required)
            </Text>
          </Text>
          <TextArea
            placeholder="Leave a comment about these changes..."
            {...form.register("comment")}
            rows={4}
            required
            style={{ width: "100%" }}
          />
        </Box>
      </Card>
    </Box>
  );
});

ApprovalFlowReview.displayName = "ApprovalFlowReview";

export default ApprovalFlowReview;
