import React, { useState, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import { AIPromptDefaults, AIPromptInterface } from "shared/ai";
import { useAuth } from "@/services/auth";
import Frame from "@/components/Radix/Frame";
import Field from "@/components/Forms/Field";
import Checkbox from "@/components/Radix/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import { isCloud } from "@/services/env";
import useApi from "@/hooks/useApi";
import Button from "@/components/Radix/Button";

// create a temp function which is passed a project and returns an array of prompts (promptId, promptName, promptDescription, promptValue)
function getPrompts(data: {
  prompts: AIPromptInterface[];
}): Array<{
  promptType: string;
  promptName: string;
  promptDescription: string;
  promptValue: string;
  promptDefaultValue: string;
  promptHelpText: string;
}> {
  return [
    {
      promptType: "experiment-analysis",
      promptName: "Experiment Analysis",
      promptDescription:
        "When an experiment is stopped, this prompt creates an analysis of the results.",
      promptValue:
        data.prompts.find((p) => p.type === "experiment-analysis")?.prompt ||
        AIPromptDefaults["experiment-analysis"],
      promptDefaultValue: AIPromptDefaults["experiment-analysis"],
      promptHelpText:
        "Make sure to explain the format of the results you would like to see.",
    },
    {
      promptType: "experiment-hypothesis",
      promptName: "Hypothesis Format",
      promptDescription:
        "Specify a style for your hypothesis so that it is consistent across experiments.",
      promptValue:
        data.prompts.find((p) => p.type === "experiment-hypothesis")?.prompt ||
        AIPromptDefaults["experiment-hypothesis"],
      promptDefaultValue: AIPromptDefaults["experiment-hypothesis"],
      promptHelpText: "",
    },
    {
      promptType: "metric-description",
      promptName: "Metric Description",
      promptDescription:
        "When a metric is created, this prompt creates a description of the metric.",
      promptValue:
        data.prompts.find((p) => p.type === "metric-description")?.prompt ||
        AIPromptDefaults["metric-description"],
      promptDefaultValue: AIPromptDefaults["metric-description"],
      promptHelpText:
        "Make sure to explain the format of the results you would like to see.",
    },
  ];
}

const openAIModels = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-4", label: "gpt-4" },
  { value: "gpt-4-turbo", label: "gpt-4-turbo" },
  { value: "gpt-4-vision-preview", label: "gpt-4-vision-preview" },
  { value: "gpt-3.5-turbo", label: "gpt-3.5-turbo" },
  { value: "gpt-3.5-turbo-16k", label: "gpt-3.5-turbo-16k" },
];

export default function AISettings({
  promptForm,
}: {
  promptForm: UseFormReturn;
}) {
  const form = useFormContext();
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const [embeddingMsg, setEmbeddingMsg] = useState("");

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      await apiCall("/experiments/regenerate-embeddings", {
        method: "POST",
      });
      setEmbeddingMsg("Embeddings have been regenerated successfully.");
    } catch (error) {
      console.error("Error regenerating embeddings:", error);
    } finally {
      setLoading(false);
    }
  };

  const { data, isLoading } = useApi<{
    prompts: AIPromptInterface[];
  }>(`/ai/prompts`);

  // Run the logic only once when `data` is loaded
  useEffect(() => {
    if (data) {
      const prompts = getPrompts(data);
      prompts.forEach((prompt) => {
        promptForm.setValue(prompt.promptType, prompt.promptValue);
      });
    }
  }, [data, promptForm]);

  if (isLoading || !data) return null;

  const prompts = getPrompts(data);

  return (
    <>
      <Frame>
        <Flex gap="4">
          <Box width="220px" flexShrink="0">
            <Heading size="4" as="h4">
              AI Settings
            </Heading>
          </Box>

          <Flex align="start" direction="column" flexGrow="1" pt="6">
            <Flex align="start" gap="3" mb="6">
              <Box>
                <Checkbox
                  value={form.watch("aiEnabled")}
                  setValue={(v) => form.setValue("aiEnabled", v)}
                  id="toggle-aiEnabled"
                  mt="1"
                />
              </Box>
              <Flex direction="column">
                <Text size="3" className="font-weight-semibold">
                  <label htmlFor="toggle-aiEnabled">Enable AI features</label>
                </Text>
                <Text>
                  Used to allow various AI features throughout GrowthBook.
                </Text>
              </Flex>
            </Flex>
            {form.watch("aiEnabled") && !isCloud() && (
              <>
                <Box mb="6" width="100%">
                  <Text
                    as="label"
                    htmlFor="openaiAPIKey"
                    size="3"
                    className="font-weight-semibold"
                  >
                    Open AI Key
                  </Text>
                  <Field
                    type="password"
                    id="openaiAPIKey"
                    {...form.register("openAIAPIKey")}
                    placeholder=""
                    helpText="Your OpenAI API key to use when generating AI responses."
                  />
                </Box>
                <Box mb="6" width="100%">
                  <Text
                    as="label"
                    htmlFor="openaiModel"
                    size="3"
                    className="font-weight-semibold"
                  >
                    OpenAI model
                  </Text>
                  <SelectField
                    id="openaiModel"
                    helpText="Default is 4o-mini."
                    value={form.watch("openAIDefaultModel")}
                    onChange={(v) => form.setValue("openAIDefaultModel", v)}
                    options={openAIModels}
                    initialOption="gpt-4o-mini"
                  />
                </Box>
              </>
            )}
          </Flex>
        </Flex>
      </Frame>

      {/* Prompts Section */}
      {form.watch("aiEnabled") && (
        <>
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="4" as="h4">
                  Prompts
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <>
                  <Box mb="6" width="100%">
                    <>
                      {prompts.map((prompt, index) => (
                        <Box key={index} mb="6" width="100%">
                          <Box>
                            <Text
                              size="3"
                              className="font-weight-semibold"
                              mb="1"
                            >
                              {prompt.promptName}
                            </Text>
                          </Box>
                          <Box mb="2">
                            <Text size="2" mb="2">
                              {prompt.promptDescription}
                            </Text>
                          </Box>
                          <Field
                            textarea={true}
                            id={`prompt-${prompt.promptType}`}
                            placeholder=""
                            helpText={prompt.promptHelpText}
                            {...promptForm.register(prompt.promptType)}
                          />
                          {prompt.promptDefaultValue !==
                            promptForm.watch(prompt.promptType) && (
                            <Box style={{ position: "relative" }}>
                              <Box
                                style={{
                                  position: "absolute",
                                  right: "0",
                                  top: prompt.promptHelpText ? "-14px" : "-1px",
                                }}
                              >
                                <a
                                  href="#"
                                  title="Reset to the default AI prompt"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    promptForm.setValue(
                                      prompt.promptType,
                                      prompt.promptDefaultValue
                                    );
                                  }}
                                >
                                  reset
                                </a>
                              </Box>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </>
                  </Box>
                </>
              </Flex>
            </Flex>
          </Frame>
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="4" as="h4">
                  Embeddings
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <>
                  <Box mb="6" width="100%">
                    <>
                      <p>
                        GrowthBook can use AI to analyze your experiments for
                        semantic meaning. This is used to help you find related
                        experiments, and to generate summaries of your
                        experiments.
                      </p>
                      <p>
                        These similarity scores are automatically updated, but
                        if the results seem off, you can regenerate them here.
                      </p>
                      <Button
                        onClick={handleRegenerate}
                        disabled={loading}
                        variant="solid"
                      >
                        {loading ? "Regenerating..." : "Regenerate all"}
                      </Button>
                    </>
                    <Box mt="3">{embeddingMsg}</Box>
                  </Box>
                </>
              </Flex>
            </Flex>
          </Frame>
        </>
      )}
    </>
  );
}
