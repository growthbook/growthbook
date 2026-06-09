import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import LinkButton from "@/components/Button";
import RadioGroup from "@/ui/RadioGroup";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import { useAuth } from "@/services/auth";

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

interface Props {
  featureId: string;
  version: number;
  trigger: React.ReactNode;
  /** Prevents self-approval when blockSelfApproval is set. */
  isBlockedContributor?: boolean;
  onSuccess: () => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export default function ReviewCommentPopover({
  featureId,
  version,
  trigger,
  isBlockedContributor = false,
  onSuccess,
  side = "bottom",
  align = "end",
}: Props) {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("Comment");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setComment("");
    setDecision("Comment");
    setError(null);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiCall(`/feature/${featureId}/${version}/submit-review`, {
        method: "POST",
        body: JSON.stringify({ comment, review: decision }),
      });
      reset();
      setOpen(false);
      onSuccess();
    } catch (e) {
      setError((e as Error).message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <Box>
      <Heading as="h5" size="small" mb="3">
        Submit review
      </Heading>

      <Field
        textarea
        placeholder="Leave a comment…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        minRows={4}
      />

      <Box mt="3">
        <RadioGroup
          value={decision}
          setValue={(val: ReviewDecision) => setDecision(val)}
          options={[
            {
              value: "Comment",
              label: "Comment",
              description:
                "Submit general feedback without explicit approval.",
            },
            {
              value: "Requested Changes",
              label: "Request changes",
              description:
                "Submit feedback that must be addressed before publishing.",
            },
            {
              value: "Approved",
              label: "Approve",
              description: isBlockedContributor
                ? "You contributed to this draft and cannot approve it."
                : "Submit feedback and approve for publishing.",
              disabled: isBlockedContributor,
            },
          ]}
        />
      </Box>

      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}

      <Flex gap="2" mt="3" justify="end">
        <LinkButton
          color="link"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </LinkButton>
        <Button onClick={handleSubmit} loading={loading}>
          Submit
        </Button>
      </Flex>
    </Box>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
      trigger={trigger}
      content={content}
      side={side}
      align={align}
      showArrow={false}
      contentStyle={{ padding: 16, width: 320 }}
    />
  );
}
