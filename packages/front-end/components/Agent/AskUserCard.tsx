import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { AssistantBubble } from "@/enterprise/components/AIChat/AIChatPrimitives";

export interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

export interface AskUserPrompt {
  /** Sequential id so we can detect a fresh question superseding an older one. */
  seq: number;
  question: string;
  options: AskUserOption[];
  allowMultiple: boolean;
  /** Once the user picks (or sends another message), the prompt is resolved. */
  resolved: boolean;
}

/**
 * Renders the agent's `askUser` question as an assistant bubble with one
 * clickable option card per choice.
 */
export default function AskUserCard({
  prompt,
  loading,
  onSelect,
}: {
  prompt: AskUserPrompt;
  loading: boolean;
  onSelect: (option: AskUserOption) => void;
}) {
  return (
    <AssistantBubble>
      <Flex direction="column" gap="2">
        <Text size="small">{prompt.question}</Text>
        <Flex direction="column" gap="2">
          {prompt.options.map((opt) => (
            <AskUserOptionButton
              key={opt.id}
              option={opt}
              disabled={loading}
              onClick={() => onSelect(opt)}
            />
          ))}
        </Flex>
      </Flex>
    </AssistantBubble>
  );
}

/**
 * Multi-line "option card" rendered for each `askUser` choice. Uses a native
 * `<button>` instead of the design-system `Button` because the latter is
 * fixed single-line height — two-line label + description content overflows
 * and overlaps. Visual style matches a soft/violet button so it still reads
 * as clickable.
 */
function AskUserOptionButton({
  option,
  disabled,
  onClick,
}: {
  option: AskUserOption;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        borderRadius: "var(--radius-2)",
        border: "1px solid var(--violet-a5)",
        background:
          hover && !disabled ? "var(--violet-a4)" : "var(--violet-a3)",
        color: "var(--violet-12)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        font: "inherit",
        transition: "background 120ms ease",
      }}
    >
      <Flex direction="column" gap="1" align="start">
        <Text size="small" weight="medium">
          {option.label}
        </Text>
        {option.description && (
          <Text size="small" color="text-low">
            {option.description}
          </Text>
        )}
      </Flex>
    </button>
  );
}
