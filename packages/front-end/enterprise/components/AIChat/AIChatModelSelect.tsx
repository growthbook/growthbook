import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import { useAISettings } from "@/hooks/useOrgSettings";
import { isCloud } from "@/services/env";
import { getAvailableAIModelOptions } from "@/services/aiModelSelectOptions";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

interface AIChatModelSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string | null;
  height?: string;
}

export default function AIChatModelSelect({
  id,
  value,
  onChange,
  disabled = false,
  disabledReason = null,
  height = "35px",
}: AIChatModelSelectProps) {
  const { defaultAIModel } = useAISettings();
  const options = useMemo(() => getAvailableAIModelOptions(), []);

  if (isCloud()) return null;

  const isDisabled = disabled || !!disabledReason;

  return (
    <Tooltip enabled={!!disabledReason} content={disabledReason ?? ""}>
      <span style={disabledReason ? { cursor: "not-allowed" } : undefined}>
        <SelectField
          id={id}
          value={value}
          onChange={(v) => {
            if (!isDisabled) onChange(v);
          }}
          options={options}
          disabled={isDisabled}
          placeholder="AI model"
          formatOptionLabel={(option, { context }) => {
            if (option.value === defaultAIModel && context === "menu") {
              return (
                <Flex direction="column" gap="0">
                  <Text>{option.label}</Text>
                  <span
                    style={{
                      color: "var(--text-color-muted)",
                      fontSize: "var(--font-size-1)",
                    }}
                  >
                    Organization Default
                  </span>
                </Flex>
              );
            }
            return <span>{option.label}</span>;
          }}
          containerStyle={{
            marginBottom: 0,
            ...(disabledReason ? { pointerEvents: "none" } : undefined),
          }}
          containerStyles={{
            control: (styles) => ({
              ...styles,
              width: "150px",
              minHeight: "35px",
              height,
            }),
            valueContainer: (styles) => ({
              ...styles,
              paddingTop: 0,
              paddingBottom: 0,
            }),
            indicatorsContainer: (styles) => ({
              ...styles,
              height,
            }),
          }}
        />
      </span>
    </Tooltip>
  );
}
