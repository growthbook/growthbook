import { useState } from "react";
import { Flex, Grid, Text } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import { StoryMeta } from "@/ui/storyMeta";
import Switch from "./Switch";

export const meta: StoryMeta = {
  name: "Switch",
  category: "inputs",
  status: "stable",
  summary: "On and off toggle with an optional label and description.",
  useWhen: ["Enabling or disabling a setting, often applied immediately."],
  avoidWhen: [
    {
      reason: "Selecting items or a boolean in a list of form choices.",
      use: "Checkbox",
    },
  ],
  related: ["Checkbox"],
};

export default function SwitchStories() {
  const [switchDisabled, setSwitchDisabled] = useState(false);
  const [switchState, setSwitchState] = useState<
    "default" | "warning" | "error"
  >("default");

  return (
    <Flex direction="row" gap="3">
      <Grid flexGrow="1" columns="1fr 1fr" gap="4">
        <Flex direction="column" gap="2">
          &rarr; No label
          <Flex direction="column" gap="4">
            <Switch state={switchState} disabled={switchDisabled} />
            <Switch
              defaultValue={true}
              state={switchState}
              disabled={switchDisabled}
            />
          </Flex>
        </Flex>
        <Flex direction="column" gap="2">
          &rarr; Label
          <Flex direction="column" gap="4">
            <Switch
              state={switchState}
              disabled={switchDisabled}
              label="Label"
            />
            <Switch
              defaultValue={true}
              state={switchState}
              disabled={switchDisabled}
              label="Label"
            />
          </Flex>
        </Flex>
        <Flex direction="column" gap="2">
          &rarr; Label and description
          <Flex direction="column" gap="4">
            <Switch
              state={switchState}
              disabled={switchDisabled}
              label="Label"
              description="Description"
            />
            <Switch
              defaultValue={true}
              state={switchState}
              disabled={switchDisabled}
              label="Label"
              description="Description"
            />
          </Flex>
        </Flex>
        <Flex direction="column" gap="2">
          &rarr; Label, description and statusLabel
          <Flex direction="column" gap="4">
            <Switch
              state={switchState}
              disabled={switchDisabled}
              label="Label"
              description="Description"
              stateLabel="The status label goes here"
            />
            <Switch
              defaultValue={true}
              state={switchState}
              disabled={switchDisabled}
              label="Label"
              description="Description"
              stateLabel="The status label goes here"
            />
          </Flex>
        </Flex>
      </Grid>

      <Flex flexGrow="1" direction="column" gap="0">
        <Text weight="bold" mb="2">
          Configuration
        </Text>
        <SelectField
          size="legacy"
          label="Status"
          value={switchState}
          options={[
            { label: "Default", value: "default" },
            { label: "Warning", value: "warning" },
            { label: "Error", value: "error" },
          ]}
          onChange={(v) => setSwitchState(v as "default" | "warning" | "error")}
        />
        <SelectField
          size="legacy"
          label="Disabled"
          value={switchDisabled ? "true" : "false"}
          options={[
            { label: "False", value: "false" },
            { label: "True", value: "true" },
          ]}
          onChange={(v) => setSwitchDisabled(v === "true")}
        />
      </Flex>
    </Flex>
  );
}
