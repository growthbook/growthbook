import mongoose from "mongoose";
import { omit } from "lodash";
import {
  AIChatConversationInterface,
  AIChatMessageInterface,
} from "shared/ai-chat";

type AIChatConversationDocument = mongoose.Document &
  AIChatConversationInterface;
type AIChatMessageDocument = mongoose.Document & AIChatMessageInterface;

const conversationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  organization: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  title: { type: String, default: "New Chat" },
  dateCreated: { type: Date, default: Date.now },
  dateUpdated: { type: Date, default: Date.now },
});

conversationSchema.index({ organization: 1, userId: 1 });

const AIChatConversationModel = mongoose.model<AIChatConversationDocument>(
  "AIChatConversation",
  conversationSchema,
  "aichatconversations",
);

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  conversationId: { type: String, required: true, index: true },
  role: { type: String, required: true, enum: ["user", "assistant", "tool"] },
  content: { type: String, default: "" },
  toolCalls: { type: mongoose.Schema.Types.Mixed },
  toolResults: { type: mongoose.Schema.Types.Mixed },
  dateCreated: { type: Date, default: Date.now },
});

const AIChatMessageModel = mongoose.model<AIChatMessageDocument>(
  "AIChatMessage",
  messageSchema,
  "aichatmessages",
);

function toConversation(
  doc: AIChatConversationDocument,
): AIChatConversationInterface {
  return omit(doc.toJSON<AIChatConversationDocument>(), ["__v", "_id"]);
}

function toMessage(doc: AIChatMessageDocument): AIChatMessageInterface {
  return omit(doc.toJSON<AIChatMessageDocument>(), ["__v", "_id"]);
}

export async function createConversation(
  organization: string,
  userId: string,
  title: string = "New Chat",
): Promise<AIChatConversationInterface> {
  const id = `aichat_${new mongoose.Types.ObjectId()}`;
  const doc = await AIChatConversationModel.create({
    id,
    organization,
    userId,
    title,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toConversation(doc);
}

export async function getConversationsByUser(
  organization: string,
  userId: string,
): Promise<AIChatConversationInterface[]> {
  const docs = await AIChatConversationModel.find({
    organization,
    userId,
  }).sort({ dateUpdated: -1 });
  return docs.map(toConversation);
}

export async function getConversationById(
  organization: string,
  id: string,
): Promise<AIChatConversationInterface | null> {
  const doc = await AIChatConversationModel.findOne({ id, organization });
  return doc ? toConversation(doc) : null;
}

export async function deleteConversation(
  organization: string,
  id: string,
): Promise<void> {
  await AIChatConversationModel.deleteOne({ id, organization });
  await AIChatMessageModel.deleteMany({ conversationId: id });
}

export async function updateConversationTitle(
  organization: string,
  id: string,
  title: string,
): Promise<void> {
  await AIChatConversationModel.updateOne(
    { id, organization },
    { $set: { title, dateUpdated: new Date() } },
  );
}

export async function updateConversationTimestamp(id: string): Promise<void> {
  await AIChatConversationModel.updateOne(
    { id },
    { $set: { dateUpdated: new Date() } },
  );
}

export async function addMessages(
  conversationId: string,
  messages: Omit<AIChatMessageInterface, "id">[],
): Promise<AIChatMessageInterface[]> {
  const docs = await AIChatMessageModel.insertMany(
    messages.map((m) => ({
      ...m,
      id: `aimsg_${new mongoose.Types.ObjectId()}`,
      conversationId,
    })),
  );
  return docs.map(toMessage);
}

export async function getMessages(
  conversationId: string,
): Promise<AIChatMessageInterface[]> {
  const docs = await AIChatMessageModel.find({ conversationId }).sort({
    dateCreated: 1,
  });
  return docs.map(toMessage);
}

export async function updateMessageToolCallStatus(
  messageId: string,
  toolCallId: string,
  status: "confirmed" | "rejected",
): Promise<void> {
  const doc = await AIChatMessageModel.findOne({ id: messageId });
  if (!doc || !doc.toolCalls) return;

  const toolCalls = doc.toolCalls.map(
    (tc: { id: string; status?: string; name: string; arguments: unknown }) =>
      tc.id === toolCallId ? { ...tc, status } : tc,
  );
  await AIChatMessageModel.updateOne(
    { id: messageId },
    { $set: { toolCalls } },
  );
}
