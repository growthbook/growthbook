import { z } from "zod";

export const createConversationValidator = z.object({
  title: z.string().optional(),
});

export const sendMessageValidator = z.object({
  message: z.string().min(1),
});

export const confirmActionValidator = z.object({
  toolCallId: z.string(),
  action: z.string(),
  args: z.record(z.string(), z.unknown()),
  confirmed: z.boolean(),
});
