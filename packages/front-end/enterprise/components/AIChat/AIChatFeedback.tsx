import React, { useState, useRef, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import {
  PiThumbsUp,
  PiThumbsUpFill,
  PiThumbsDown,
  PiThumbsDownFill,
} from "react-icons/pi";
import type { AIChatFeedbackRating } from "shared/validators";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import track from "@/services/track";
import aiChatPrimitives from "./AIChatPrimitives.module.scss";

const FEEDBACK_BTN_STYLE: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 4,
  borderRadius: "var(--radius-2)",
  display: "inline-flex",
  alignItems: "center",
};

export interface FeedbackState {
  rating: AIChatFeedbackRating | null;
  comment: string;
}

interface AIChatFeedbackProps {
  messageId: string;
  value: FeedbackState;
  onSubmit: (
    messageId: string,
    rating: AIChatFeedbackRating | null,
    comment: string,
  ) => void;
}

export function AIChatFeedback({
  messageId,
  value,
  onSubmit,
}: AIChatFeedbackProps) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [draftComment, setDraftComment] = useState(value.comment);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (commentOpen) {
      setDraftComment(value.comment);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [commentOpen, value.comment]);

  const trackFeedback = useCallback(
    (
      action: "rate" | "comment" | "clear",
      rating: AIChatFeedbackRating | null,
    ) => {
      track("AI Chat Feedback", {
        action,
        rating,
        hasComment: action === "comment",
      });
    },
    [],
  );

  const handleThumbsUp = useCallback(() => {
    if (value.rating === "positive") {
      onSubmit(messageId, null, "");
      trackFeedback("clear", null);
    } else {
      onSubmit(messageId, "positive", "");
      trackFeedback("rate", "positive");
    }
    setCommentOpen(false);
  }, [value.rating, messageId, onSubmit, trackFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (value.rating === "negative") {
      onSubmit(messageId, null, "");
      trackFeedback("clear", null);
      setCommentOpen(false);
    } else {
      onSubmit(messageId, "negative", "");
      trackFeedback("rate", "negative");
      setCommentOpen(true);
    }
  }, [value.rating, messageId, onSubmit, trackFeedback]);

  const handleCommentSubmit = useCallback(() => {
    const trimmed = draftComment.trim();
    if (!trimmed) {
      setCommentOpen(false);
      return;
    }
    onSubmit(messageId, "negative", trimmed);
    trackFeedback("comment", "negative");
    setCommentOpen(false);
  }, [draftComment, messageId, onSubmit, trackFeedback]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleCommentSubmit();
      }
    },
    [handleCommentSubmit],
  );

  const thumbsDownButton = (
    <button
      type="button"
      onClick={handleThumbsDown}
      title="Bad response"
      style={FEEDBACK_BTN_STYLE}
      className={`${aiChatPrimitives.feedbackButton} ${value.rating === "negative" ? aiChatPrimitives.feedbackNegative : ""}`}
    >
      {value.rating === "negative" ? (
        <PiThumbsDownFill size={14} />
      ) : (
        <PiThumbsDown size={14} />
      )}
    </button>
  );

  return (
    <Flex align="center" gap="1" style={{ alignSelf: "flex-start" }}>
      <button
        type="button"
        onClick={handleThumbsUp}
        title="Good response"
        style={FEEDBACK_BTN_STYLE}
        className={`${aiChatPrimitives.feedbackButton} ${value.rating === "positive" ? aiChatPrimitives.feedbackPositive : ""}`}
      >
        {value.rating === "positive" ? (
          <PiThumbsUpFill size={14} />
        ) : (
          <PiThumbsUp size={14} />
        )}
      </button>

      <Popover
        open={commentOpen}
        onOpenChange={(open) => {
          if (!open) setCommentOpen(false);
        }}
        trigger={thumbsDownButton}
        side="bottom"
        align="start"
        showArrow={false}
        contentStyle={{ padding: "12px", width: 280 }}
        content={
          <Flex direction="column" gap="2">
            <Text size="small" weight="medium">
              What went wrong?
            </Text>
            <Box asChild>
              <textarea
                ref={textareaRef}
                value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)}
                onKeyDown={handleCommentKeyDown}
                placeholder="Optional feedback..."
                rows={3}
                style={{
                  width: "100%",
                  border: "1px solid var(--gray-a6)",
                  borderRadius: "var(--radius-2)",
                  padding: "6px 8px",
                  fontSize: "13px",
                  resize: "none",
                  background: "var(--color-surface)",
                  color: "var(--gray-12)",
                  fontFamily: "inherit",
                  lineHeight: 1.4,
                  outline: "none",
                }}
              />
            </Box>
            <Flex justify="end" gap="2">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setCommentOpen(false)}
              >
                Skip
              </Button>
              <Button
                size="xs"
                onClick={handleCommentSubmit}
                disabled={!draftComment.trim()}
              >
                Submit
              </Button>
            </Flex>
          </Flex>
        }
      />

      {value.comment && value.rating === "negative" && (
        <Box ml="1">
          <Text size="small" color="text-low">
            Feedback sent
          </Text>
        </Box>
      )}
    </Flex>
  );
}
