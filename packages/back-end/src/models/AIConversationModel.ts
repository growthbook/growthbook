import {
  AIConversationInterface,
  AIConversationWithoutMessages,
  aiConversationValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: aiConversationValidator,
  collectionName: "aiconversations",
  idPrefix: "conv_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { userId: 1, organization: 1, dateCreated: -1 },
    },
  ],
});

export class AIConversationModel extends BaseClass {
  protected canRead(doc: AIConversationInterface): boolean {
    return doc.userId === this.context.userId;
  }

  protected canCreate(doc: AIConversationInterface): boolean {
    return doc.userId === this.context.userId;
  }

  protected canUpdate(
    existing: AIConversationInterface,
    _updates: UpdateProps<AIConversationInterface>,
  ): boolean {
    return existing.userId === this.context.userId;
  }

  protected canDelete(existing: AIConversationInterface): boolean {
    return existing.userId === this.context.userId;
  }

  /**
   * Returns all non-empty conversations for the current user, sorted
   * newest-first, without loading the messages array.
   */
  public async listByUser(): Promise<AIConversationWithoutMessages[]> {
    const docs = await this._find(
      { userId: this.context.userId },
      {
        sort: { dateCreated: -1 },
        projection: { messages: 0 },
      },
    );
    return docs as unknown as AIConversationWithoutMessages[];
  }
}
