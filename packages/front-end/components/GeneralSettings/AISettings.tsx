import React from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import Frame from "@/components/Radix/Frame";
import Field from "@/components/Forms/Field";
import Checkbox from "@/components/Radix/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import { isCloud } from "@/services/env";

export const AIPrompts = [
  {
    promptType: "something",
    promptName: "Example Prompt 1",
    promptDescription: "This is a description for prompt 1.",
    promptValue: "Value for prompt 1",
    promptDefaultValue: "Value for prompt 1",
    promptHelpText: "Prompt help text",
  },
  {
    promptType: "2",
    promptName: "Example Prompt 2",
    promptDescription: "This is a description for prompt 2.",
    promptValue: "Value for prompt 2",
    promptDefaultValue: "Value for prompt 1",
    promptHelpText: "Prompt help text",
  },
];

// create a temp function which is passed a project and returns an array of prompts (promptId, promptName, promptDescription, promptValue)
function getPrompts(): Array<{
  promptType: string;
  promptName: string;
  promptDescription: string;
  promptValue: string;
  promptDefaultValue: string;
  promptHelpText: string;
}> {
  return [
    {
      promptType: "something",
      promptName: "Example Prompt 1",
      promptDescription: "This is a description for prompt 1.",
      promptValue: "Value for prompt 1",
      promptDefaultValue: "Value for prompt 1",
      promptHelpText: "Prompt help text",
    },
    {
      promptType: "2",
      promptName: "Example Prompt 2",
      promptDescription: "This is a description for prompt 2.",
      promptValue: "Value for prompt 2",
      promptDefaultValue: "Value for prompt 1",
      promptHelpText: "Prompt help text",
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

  const prompts = getPrompts();

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
                    value={form.watch("openAIModel")}
                    onChange={(v) => form.setValue("openAIModel", v)}
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
                                top: "-14px",
                              }}
                            >
                              <a
                                href="#"
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
      )}
    </>
  );
}
