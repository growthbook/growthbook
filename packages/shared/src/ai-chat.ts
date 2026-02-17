// AI Chat types for in-app conversational assistant

export interface AIChatConversationInterface {
  id: string;
  organization: string;
  userId: string;
  title: string;
  dateCreated: Date;
  dateUpdated: Date;
}

export type AIChatMessageRole = "user" | "assistant" | "tool";

export type AIChatToolCallStatus =
  | "pending_confirmation"
  | "confirmed"
  | "rejected";

export interface AIChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status?: AIChatToolCallStatus;
}

export interface AIChatToolResult {
  toolCallId: string;
  result: unknown;
}

export interface AIChatMessageInterface {
  id: string;
  conversationId: string;
  role: AIChatMessageRole;
  content: string;
  toolCalls?: AIChatToolCall[];
  toolResults?: AIChatToolResult[];
  dateCreated: Date;
}

export interface AIChatConfirmationAction {
  toolCallId: string;
  toolName: string;
  description: string;
  args: Record<string, unknown>;
  status: AIChatToolCallStatus;
}
