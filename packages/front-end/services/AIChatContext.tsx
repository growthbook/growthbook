import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  ReactNode,
} from "react";
import {
  AIChatConversationInterface,
  AIChatMessageInterface,
  AIChatConfirmationAction,
} from "shared/ai-chat";
import { useAuth } from "@/services/auth";
import { getApiHost } from "@/services/env";

interface AIChatContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  conversations: AIChatConversationInterface[];
  activeConversationId: string | null;
  messages: AIChatMessageInterface[];
  isStreaming: boolean;
  streamingContent: string;
  pendingConfirmations: AIChatConfirmationAction[];
  toolCallResults: {
    id: string;
    name: string;
    result: unknown;
  }[];
  sendMessage: (content: string) => Promise<void>;
  confirmAction: (
    action: AIChatConfirmationAction,
    confirmed: boolean,
  ) => Promise<void>;
  newConversation: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  error: string | null;
}

const AIChatContext = createContext<AIChatContextValue | null>(null);

export function useAIChat(): AIChatContextValue {
  const ctx = useContext(AIChatContext);
  if (!ctx) {
    throw new Error("useAIChat must be used within AIChatProvider");
  }
  return ctx;
}

export function useAIChatPanel(): Pick<
  AIChatContextValue,
  "isOpen" | "setIsOpen"
> {
  const ctx = useContext(AIChatContext);
  return {
    isOpen: ctx?.isOpen ?? false,
    setIsOpen: ctx?.setIsOpen ?? (() => {}),
  };
}

export function AIChatProvider({ children }: { children: ReactNode }) {
  const { apiCall, getAuthHeaders } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<
    AIChatConversationInterface[]
  >([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<AIChatMessageInterface[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingConfirmations, setPendingConfirmations] = useState<
    AIChatConfirmationAction[]
  >([]);
  const [toolCallResults, setToolCallResults] = useState<
    { id: string; name: string; result: unknown }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiCall<{
        conversations: AIChatConversationInterface[];
      }>("/ai-chat/conversations");
      if (res.conversations) {
        setConversations(res.conversations);
      }
    } catch (e) {
      // Silently fail - AI chat might not be enabled
    }
  }, [apiCall]);

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        setError(null);
        const res = await apiCall<{
          conversation: AIChatConversationInterface;
          messages: AIChatMessageInterface[];
        }>(`/ai-chat/conversations/${id}`);
        if (res.conversation) {
          setActiveConversationId(id);
          setMessages(res.messages || []);
          setPendingConfirmations([]);
          setToolCallResults([]);
          setStreamingContent("");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load conversation",
        );
      }
    },
    [apiCall],
  );

  const newConversation = useCallback(async () => {
    try {
      setError(null);
      const res = await apiCall<{
        conversation: AIChatConversationInterface;
      }>("/ai-chat/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.conversation) {
        setActiveConversationId(res.conversation.id);
        setMessages([]);
        setPendingConfirmations([]);
        setToolCallResults([]);
        setStreamingContent("");
        setConversations((prev) => [res.conversation, ...prev]);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create conversation",
      );
    }
  }, [apiCall]);

  const deleteConversationFn = useCallback(
    async (id: string) => {
      try {
        await apiCall(`/ai-chat/conversations/${id}`, {
          method: "DELETE",
        });
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setMessages([]);
          setPendingConfirmations([]);
          setToolCallResults([]);
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to delete conversation",
        );
      }
    },
    [apiCall, activeConversationId],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      setError(null);

      let conversationId = activeConversationId;

      // Auto-create conversation if none active
      if (!conversationId) {
        try {
          const res = await apiCall<{
            conversation: AIChatConversationInterface;
          }>("/ai-chat/conversations", {
            method: "POST",
            body: JSON.stringify({
              title: content.slice(0, 50),
            }),
          });
          if (res.conversation) {
            conversationId = res.conversation.id;
            setActiveConversationId(conversationId);
            setConversations((prev) => [res.conversation, ...prev]);
          }
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Failed to create conversation",
          );
          return;
        }
      }

      // Add user message to local state immediately
      const userMsg: AIChatMessageInterface = {
        id: `temp_${Date.now()}`,
        conversationId: conversationId!,
        role: "user",
        content,
        dateCreated: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");
      setPendingConfirmations([]);
      setToolCallResults([]);

      try {
        const abort = new AbortController();
        abortRef.current = abort;

        const apiHost = getApiHost();
        const response = await fetch(
          `${apiHost}/ai-chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({
              message: content,
              currentPage: window.location.pathname,
            }),
            signal: abort.signal,
            credentials: "include",
          },
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new Error(errData?.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);
              switch (data.type) {
                case "text-delta":
                  fullText += data.content;
                  setStreamingContent(fullText);
                  break;
                case "tool-call":
                  if (data.confirmationRequired) {
                    setPendingConfirmations((prev) => [
                      ...prev,
                      {
                        toolCallId: data.id,
                        toolName: data.name,
                        description: data.result?.description || data.name,
                        args: data.result?.args || data.args,
                        status: "pending_confirmation",
                      },
                    ]);
                  } else {
                    setToolCallResults((prev) => [
                      ...prev,
                      {
                        id: data.id,
                        name: data.name,
                        result: data.result,
                      },
                    ]);
                  }
                  break;
                case "done":
                  // Add assistant message to local state
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `aimsg_${Date.now()}`,
                      conversationId: conversationId!,
                      role: "assistant",
                      content: data.content,
                      dateCreated: new Date(),
                    },
                  ]);
                  setStreamingContent("");
                  break;
                case "error":
                  setError(data.content);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Failed to send message");
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [apiCall, getAuthHeaders, activeConversationId, isStreaming],
  );

  const confirmAction = useCallback(
    async (action: AIChatConfirmationAction, confirmed: boolean) => {
      if (!activeConversationId) return;

      try {
        const res = await apiCall<{ result: string }>(
          `/ai-chat/conversations/${activeConversationId}/confirm`,
          {
            method: "POST",
            body: JSON.stringify({
              toolCallId: action.toolCallId,
              action: action.toolName.replace("propose_", ""),
              args: action.args,
              confirmed,
            }),
          },
        );

        // Update confirmation status
        setPendingConfirmations((prev) =>
          prev.map((c) =>
            c.toolCallId === action.toolCallId
              ? { ...c, status: confirmed ? "confirmed" : "rejected" }
              : c,
          ),
        );

        // Add a system-like message showing the result
        if (confirmed && res.result) {
          setMessages((prev) => [
            ...prev,
            {
              id: `aimsg_confirm_${Date.now()}`,
              conversationId: activeConversationId,
              role: "assistant",
              content: res.result,
              dateCreated: new Date(),
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to confirm action");
      }
    },
    [apiCall, activeConversationId],
  );

  return (
    <AIChatContext.Provider
      value={{
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
        deleteConversation: deleteConversationFn,
        loadConversations,
        error,
      }}
    >
      {children}
    </AIChatContext.Provider>
  );
}
