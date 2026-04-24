import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowRightBold, PiStop } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";

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
}: ChatInputBarProps) {
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
