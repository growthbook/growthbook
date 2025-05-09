import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

export default function useOrgSettings() {
  const { settings } = useUser();
  return settings;
}
export const useAISettings = (
  includeKey: boolean = false
): {
  aiEnabled: boolean;
  openAIModel: string;
  openAIKey?: string;
} => {
  const { settings } = useUser();
  const aiEnabled = isCloud()
    ? settings?.aiEnabled !== false
    : !!(settings?.aiEnabled && settings.openAIModel && settings.openAIAPIKey);
  const openAIModel = settings?.openAIModel || "gpt-4o-mini";
  const openAIKey = includeKey ? settings?.openAIAPIKey || "" : "";
  return { aiEnabled, openAIModel, openAIKey };
};
