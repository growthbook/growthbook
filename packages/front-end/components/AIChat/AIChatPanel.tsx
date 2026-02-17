import { FC, useEffect, useRef, useState } from "react";
import { PiX, PiPlus, PiList, PiRobot } from "react-icons/pi";
import clsx from "clsx";
import { useAIChat } from "@/services/AIChatContext";
import Markdown from "@/components/Markdown/Markdown";
import AIChatMessage from "./AIChatMessage";
import AIChatInput from "./AIChatInput";
import AIChatConfirmation from "./AIChatConfirmation";
import AIChatConversationList from "./AIChatConversationList";
import styles from "./AIChatPanel.module.scss";

const AIChatPanel: FC = () => {
  const {
    isOpen,
    setIsOpen,
    conversations,
    activeConversationId,
    messages,
    isStreaming,
    streamingContent,
    pendingConfirmations,
    toolCallResults,
    sendMessage,
    confirmAction,
    newConversation,
    loadConversation,
    deleteConversation,
    loadConversations,
    error,
  } = useAIChat();

  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (!isOpen) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            className={styles.iconButton}
            onClick={() => setShowHistory(!showHistory)}
            title="Conversation history"
          >
            <PiList size={18} />
          </button>
          <span className={styles.headerTitle}>
            <PiRobot size={16} />
            GrowthBook AI
          </span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconButton}
            onClick={() => {
              newConversation();
              setShowHistory(false);
            }}
            title="New chat"
          >
            <PiPlus size={18} />
          </button>
          <button
            className={styles.iconButton}
            onClick={() => setIsOpen(false)}
            title="Close"
          >
            <PiX size={18} />
          </button>
        </div>
      </div>

      {showHistory && (
        <AIChatConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={(id) => {
            loadConversation(id);
            setShowHistory(false);
          }}
          onDelete={deleteConversation}
        />
      )}

      <div
        className={clsx(styles.messagesArea, {
          [styles.hidden]: showHistory,
        })}
      >
        {messages.length === 0 && !isStreaming && (
          <div className={styles.emptyState}>
            <PiRobot size={40} className="text-muted mb-2" />
            <p className="text-muted mb-1">
              Ask me about your experiments and features
            </p>
            <p className="text-muted small">
              I can help you list experiments, check feature flags, understand
              metrics, and more.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <AIChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingContent && (
          <div className={clsx(styles.message, styles.assistantMessage)}>
            <div className={styles.messageIcon}>
              <PiRobot size={16} />
            </div>
            <div className={styles.messageContent}>
              <Markdown className={styles.messageText}>
                {streamingContent}
              </Markdown>
            </div>
          </div>
        )}

        {/* Tool call results */}
        {toolCallResults.length > 0 && isStreaming && (
          <div className={styles.toolCallIndicator}>Looking up data...</div>
        )}

        {/* Pending confirmations */}
        {pendingConfirmations.map((action) => (
          <AIChatConfirmation
            key={action.toolCallId}
            action={action}
            onConfirm={confirmAction}
          />
        ))}

        {/* Loading indicator */}
        {isStreaming && !streamingContent && (
          <div className={styles.loadingIndicator}>
            <div className={styles.typingDots}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {/* Error display */}
        {error && <div className={styles.errorMessage}>{error}</div>}

        <div ref={messagesEndRef} />
      </div>

      <AIChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
};

export default AIChatPanel;
