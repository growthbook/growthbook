import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import LinkButton from "@/components/Button";
import RadioGroup from "@/ui/RadioGroup";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useAuth } from "@/services/auth";

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

interface Props {
  featureId: string;
  version: number;
  // Render prop so the trigger can react to the popover's open state — e.g.
  // disable itself while the panel is mounted to prevent re-toggle clicks.
  trigger: React.ReactNode | ((state: { open: boolean }) => React.ReactNode);
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

      <MarkdownInput
        value={comment}
        setValue={setComment}
        placeholder="Leave a comment…"
        showButtons={false}
      />

      <Box mt="5">
        <RadioGroup
          value={decision}
          setValue={(val: ReviewDecision) => setDecision(val)}
          options={[
            {
              value: "Comment",
              label: "Comment",
              description: "General feedback, no decision.",
            },
            {
              value: "Requested Changes",
              label: "Request changes",
              description: "Must be addressed before publishing.",
            },
            {
              value: "Approved",
              label: "Approve",
              description: isBlockedContributor
                ? "You contributed to this draft and cannot approve it."
                : "Approve for publishing.",
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

  const resolvedTrigger =
    typeof trigger === "function" ? trigger({ open }) : trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
      trigger={resolvedTrigger}
      content={content}
      side={side}
      align={align}
      showArrow={false}
      contentStyle={{ padding: 16, width: 560, maxWidth: "calc(100vw - 32px)" }}
    />
  );
}
