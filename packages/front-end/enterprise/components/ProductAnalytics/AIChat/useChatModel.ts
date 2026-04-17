import { useState, useMemo } from "react";
import type { AIPromptInterface } from "shared/ai";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import { PA_AI_CHAT_INITIAL_MODEL_KEY } from "@/enterprise/components/ProductAnalytics/util";

export function useChatModel(defaultAIModel: string) {
  const [chatModel, setChatModel] = useState(() => {
    const stored = sessionStorage.getItem(PA_AI_CHAT_INITIAL_MODEL_KEY);
    if (stored) {
      sessionStorage.removeItem(PA_AI_CHAT_INITIAL_MODEL_KEY);
      return stored;
    }
    return defaultAIModel;
  });

  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    `/ai/prompts`,
    { shouldRun: () => !isCloud() },
  );

  const orgOverrideModel = useMemo(() => {
    if (!promptsData?.prompts) return "";
    return (
      promptsData.prompts.find((p) => p.type === "product-analytics-chat")
        ?.overrideModel ?? ""
    );
  }, [promptsData]);

  return {
    chatModel,
    setChatModel,
    orgOverrideModel,
  };
}
