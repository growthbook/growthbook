import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import Badge from "./Badge";
import Checkbox from "./Checkbox";
import LabelWithHelp from "./LabelWithHelp";

export default function LabelWithHelpStories() {
  const [checked, setChecked] = useState(false);

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Variants
        </Text>
        <Flex direction="column" gap="2" align="start">
          {/* Label only: renders the label as-is with no wrapper. */}
          <LabelWithHelp label="Label only" />
          {/* Help: adds a PiInfo icon with a tooltip (hover to read it). */}
          <LabelWithHelp
            label="With help"
            help="Shown on hover. Use this for a short explanation or tradeoff that doesn't fit in the label."
          />
          {/* Adornment: an arbitrary trailing node, e.g. a PremiumTooltip. */}
          <LabelWithHelp
            label="With adornment"
            adornment={<Badge color="violet" variant="soft" label="Pro" />}
          />
          {/* Both help and adornment together. */}
          <LabelWithHelp
            label="With help and adornment"
            help="The help icon comes first, then any trailing adornment."
            adornment={<Badge color="violet" variant="soft" label="Pro" />}
          />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Inside a Checkbox label
        </Text>
        <Text size="1" style={{ color: "var(--gray-9)" }}>
          The help icon is focusable (tab to it to open the tooltip on keyboard
          / screen readers). Clicking the help icon or the adornment does not
          toggle the checkbox; clicking the label text does.
        </Text>
        <Flex direction="column" gap="2" align="start">
          <Checkbox
            label={
              <LabelWithHelp
                label="Weight results across update periods"
                help="Each update period is weighted proportionally to traffic received. This reduces bias, but adds variance."
                adornment={<Badge color="violet" variant="soft" label="Pro" />}
              />
            }
            value={checked}
            setValue={setChecked}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}
