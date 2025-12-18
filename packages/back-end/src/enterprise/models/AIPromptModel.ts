import { AIPromptType, AI_PROMPT_DEFAULTS } from "shared/ai";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { aiPromptValidator } from "back-end/src/routers/ai/ai.validators";

const BaseClass = MakeModelClass({
  schema: aiPromptValidator,
  collectionName: "aiprompts",
  idPrefix: "aiprompt_",
  auditLog: {
    entity: "aiPrompt",
    createEvent: "aiPrompt.create",
    updateEvent: "aiPrompt.update",
    deleteEvent: "aiPrompt.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        type: 1,
      },
      unique: true,
    },
  ],
});

export class AiPromptModel extends BaseClass {
  protected canRead(): boolean {
    // TODO: should this be something else?  Perhaps readonly users shouldn't be able to access
    // it as they shouldn't be able to call an endpoint that would need AI's help.
    return true;
  }
  protected canCreate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canUpdate(): boolean {
    return this.canCreate();
  }
  protected canDelete(): boolean {
    return this.canCreate();
  }

  public getAIPrompt = async (type: AIPromptType) => {
    const existing = await this._findOne({
      type,
    });
    return existing
      ? {
          isDefaultPrompt: false,
          prompt: existing.prompt,
          textModel: existing.textModel,
        }
      : {
          isDefaultPrompt: true,
          prompt: AI_PROMPT_DEFAULTS[type],
          textModel: undefined,
        };
  };
}
