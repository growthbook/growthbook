import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowRightBold, PiStop } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import styles from "./ChatInputBar.module.scss";

interface ChatInputBarProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
  placeholder?: string;
  /**
   * "wide" (default) is the centered, max-width layout used by the PA Explorer
   * chat. "compact" is a unified rounded composer tuned for the narrow
   * site-wide agent panel.
   */
  variant?: "wide" | "compact";
}

export default function ChatInputBar({
  inputRef,
  input,
  onInputChange,
  onKeyDown,
  onSend,
  onCancel,
  loading,
  isLocalStream,
  placeholder = "Ask about metrics, experiments, or setup...",
  variant = "wide",
}: ChatInputBarProps) {
  if (variant === "compact") {
    return (
      <CompactComposer
        inputRef={inputRef}
        input={input}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onSend={onSend}
        onCancel={onCancel}
        loading={loading}
        isLocalStream={isLocalStream}
        placeholder={placeholder}
      />
    );
  }

  return (
    <Flex
      direction="column"
      gap="4"
      py="5"
      align="center"
      justify="center"
      px="9"
      style={{
        borderTop: "1px solid var(--gray-a3)",
        background: "var(--color-panel-solid)",
      }}
    >
      <Flex gap="2" width="100%" align="center" justify="center">
        <Field
          placeholder={placeholder}
          containerStyle={{ maxWidth: "800px", flex: 1 }}
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        {isLocalStream ? (
          <Button onClick={onCancel} title="Cancel generation">
            <PiStop size={16} />
          </Button>
        ) : (
          <Button onClick={onSend} disabled={!input.trim() || loading}>
            <PiArrowRightBold size={16} />
          </Button>
        )}
      </Flex>
    </Flex>
  );
}

function CompactComposer({
  inputRef,
  input,
  onInputChange,
  onKeyDown,
  onSend,
  onCancel,
  loading,
  isLocalStream,
  placeholder,
}: Omit<ChatInputBarProps, "variant">) {
  const [focused, setFocused] = useState(false);

  return (
    <div className={styles.compactWrapper}>
      <div
        className={`${styles.composer}${focused ? ` ${styles.composerFocused}` : ""}`}
      >
        <Field
          textarea
          minRows={1}
          maxRows={6}
          placeholder={placeholder}
          containerClassName={styles.composerField}
          className={styles.composerTextarea}
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={loading}
        />
        {isLocalStream ? (
          <button
            type="button"
            className={`${styles.sendButton} ${styles.stopButton}`}
            onClick={onCancel}
            title="Cancel generation"
            aria-label="Cancel generation"
          >
            <PiStop size={15} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendButton}
            onClick={onSend}
            disabled={!input.trim() || loading}
            title="Send message"
            aria-label="Send message"
          >
            <PiArrowRightBold size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
