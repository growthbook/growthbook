import { tool as aiTool } from "ai";
import { z } from "zod";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import type { ApiReqContext } from "back-end/types/api";

// Returns the org's visual-editor brand context — currently the free-
// text `visualEditorAIContext` setting from AI Settings. This is also
// available in the system prompt today, but exposing it as a tool gives
// the model agency: it can fetch context only when the prompt is about
// brand / style consistency. Future expansion: structured tokens
// (primary color, font scale, spacing scale) once the org-settings UI
// supports them.

const inputSchema = z.object({});

export function getDesignTokensTool(context: ApiReqContext) {
  return aiTool({
    description:
      "Fetch the organization's brand guidelines and design context. Call this when the user asks for a change that should be 'on brand', 'match the site style', 'use the brand colors', or similar. Returns free-text guidelines set by the org admin. Skip this for prompts that are purely about specific elements with no brand-tone implication.",
    inputSchema,
    execute: async () => {
      const { visualEditorAIContext } = getAISettingsForOrg(context, true);
      if (!visualEditorAIContext) {
        return {
          ok: true,
          guidelines: null,
          note: "No brand guidelines have been configured for this organization. Proceed using the page's own visual cues as the source of truth.",
        } as const;
      }
      return {
        ok: true,
        guidelines: visualEditorAIContext,
      } as const;
    },
  });
}
