import { FC, useState } from "react";
import clsx from "clsx";
import { PiCaretDown, PiCaretRight, PiUser } from "react-icons/pi";
import { AIChatMessageInterface } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import styles from "./AIChatPanel.module.scss";

interface Props {
  message: AIChatMessageInterface;
  toolCallResults?: { id: string; name: string; result: unknown }[];
}

const AIChatMessage: FC<Props> = ({ message, toolCallResults }) => {
  const isUser = message.role === "user";

  return (
    <div
      className={clsx(styles.message, {
        [styles.userMessage]: isUser,
        [styles.assistantMessage]: !isUser,
      })}
    >
      <div className={styles.messageIcon}>
        {isUser ? (
          <PiUser size={16} />
        ) : (
          <img src="/images/abbie-head.png" alt="Abbie" width={24} />
        )}
      </div>
      <div className={styles.messageContent}>
        {isUser ? (
          <div className={styles.messageText}>{message.content}</div>
        ) : (
          <Markdown className={styles.messageText}>{message.content}</Markdown>
        )}
        {toolCallResults && toolCallResults.length > 0 && (
          <div className={styles.toolResults}>
            {toolCallResults.map((tc) => (
              <ToolCallResult key={tc.id} name={tc.name} result={tc.result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function ToolCallResult({ name, result }: { name: string; result: unknown }) {
  const [expanded, setExpanded] = useState(false);

  const displayName = name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <div className={styles.toolCallResult}>
      <button
        className={styles.toolCallToggle}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <PiCaretDown size={12} /> : <PiCaretRight size={12} />}
        <span className={styles.toolCallName}>{displayName}</span>
      </button>
      {expanded && (
        <pre className={styles.toolCallData}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default AIChatMessage;
