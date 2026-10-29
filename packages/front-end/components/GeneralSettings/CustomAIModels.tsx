import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import { AIProvider, AI_PROVIDER_META, getCustomModelKey } from "shared/ai";
import { AICustomModel } from "shared/validators";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";

type APIFormat = NonNullable<AICustomModel["apiFormat"]>;

const API_FORMAT_LABELS: Record<APIFormat, string> = {
  chat: "Chat Completions",
  responses: "Responses",
};

export default function CustomAIModels({
  models,
  providers,
  canEdit,
  onChange,
}: {
  models: AICustomModel[];
  providers: readonly AIProvider[];
  canEdit: boolean;
  // Also receives the key of a removed model, so settings using it can reset.
  onChange: (models: AICustomModel[], removedKey?: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<AIProvider | "">("");
  const [id, setId] = useState("");
  const [apiFormat, setApiFormat] = useState<APIFormat | "">("");
  const [vision, setVision] = useState(false);

  const reset = () => {
    setAdding(false);
    setProvider("");
    setId("");
    setApiFormat("");
    setVision(false);
  };

  const trimmedId = id.trim();
  const duplicate = models.some(
    (m) => m.provider === provider && m.id === trimmedId,
  );
  const canAdd =
    !!provider &&
    !!trimmedId &&
    !duplicate &&
    (provider !== "openai" || !!apiFormat);

  const add = () => {
    if (!canAdd) return;
    onChange([
      ...models,
      {
        provider,
        id: trimmedId,
        ...(provider === "openai" && apiFormat ? { apiFormat } : {}),
        vision,
      },
    ]);
    reset();
  };

  return (
    <Box mb="6" width="100%">
      <Text size="lg" weight="semibold" as="div">
        Custom models
      </Text>
      <Text size="md" color="text-mid" as="div" mb="3">
        Add model IDs that aren&apos;t in the lists below, such as the names
        your AI gateway exposes or a fine-tuned model. They show up in every
        model picker under their provider.
      </Text>

      {models.map((m) => (
        <Frame key={getCustomModelKey(m)} p="3" mb="3">
          <Flex align="center" gap="3" wrap="wrap">
            <Box flexGrow="1" minWidth="200px">
              <Text size="md" weight="semibold" as="div">
                <code>{m.id}</code>
              </Text>
              <Text size="sm" color="text-mid" as="div">
                {AI_PROVIDER_META[m.provider].label}
                {m.apiFormat ? ` · ${API_FORMAT_LABELS[m.apiFormat]} API` : ""}
                {m.vision ? " · Accepts images" : ""}
              </Text>
            </Box>
            {canEdit && (
              <Button
                variant="ghost"
                color="red"
                onClick={() =>
                  onChange(
                    models.filter((other) => other !== m),
                    getCustomModelKey(m),
                  )
                }
              >
                Remove
              </Button>
            )}
          </Flex>
        </Frame>
      ))}

      {adding && (
        <Frame p="3" mb="3">
          <SelectField
            label="Provider"
            size="medium"
            value={provider}
            onChange={(v) => setProvider(v as AIProvider)}
            placeholder="Select a provider"
            helpText="The provider whose API format this model uses, which may differ from where it's hosted."
            options={providers.map((p) => ({
              value: p,
              label: AI_PROVIDER_META[p].label,
            }))}
          />
          <Field
            label="Model ID"
            size="md"
            autoComplete="off"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="my-gateway-model"
            helpText="Sent exactly as written. We can't check that your provider serves this model, so try an AI feature after saving."
            error={duplicate ? "This model is already listed." : undefined}
          />
          {provider === "openai" && (
            <Box mb="3">
              <Text size="md" weight="semibold" as="div" mb="2">
                API format
              </Text>
              <RadioGroup
                value={apiFormat}
                setValue={(v) => setApiFormat(v as APIFormat)}
                options={[
                  {
                    value: "chat",
                    label: "Chat Completions (/chat/completions)",
                    description: "Supported by most gateways and proxies.",
                  },
                  {
                    value: "responses",
                    label: "Responses (/responses)",
                    description: "OpenAI's newer API.",
                  },
                ]}
              />
            </Box>
          )}
          <Checkbox
            label="Accepts image input"
            description="Lets the AI Visual Editor send it screenshots and designs."
            value={vision}
            setValue={setVision}
            mb="3"
          />
          <Flex gap="2">
            <Button onClick={add} disabled={!canAdd}>
              Add model
            </Button>
            <Button variant="ghost" color="gray" onClick={reset}>
              Cancel
            </Button>
          </Flex>
        </Frame>
      )}

      {providers.length === 0 ? (
        <Text size="sm" color="text-mid" as="div">
          Add a provider key above to add custom models.
        </Text>
      ) : (
        canEdit &&
        !adding && (
          <Button
            variant="solid"
            icon={<PiPlusBold />}
            onClick={() => setAdding(true)}
          >
            New custom model
          </Button>
        )
      )}
    </Box>
  );
}
