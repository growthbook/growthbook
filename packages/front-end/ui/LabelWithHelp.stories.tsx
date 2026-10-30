import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "./Text";
import Badge from "./Badge";
import Checkbox from "./Checkbox";
import LabelWithHelp from "./LabelWithHelp";

export default function LabelWithHelpStories() {
  const [checked, setChecked] = useState(false);

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text size="md" weight="semibold">
          Variants
        </Text>
        <Flex direction="column" gap="2" align="start">
          <LabelWithHelp label="Label only" />
          <LabelWithHelp
            label="With help"
            help="Shown on hover. Use this for a short explanation or tradeoff that doesn't fit in the label."
          />
          {/* Adornment: an arbitrary trailing node. In the product this is
              typically a PremiumTooltip; here we use a neutral badge so the
              example reads as "any node", not as the premium marker. */}
          <LabelWithHelp
            label="With adornment"
            adornment={<Badge color="gray" variant="soft" label="New" />}
          />
          <LabelWithHelp
            label="With help and adornment"
            help="The help icon comes first, then any trailing adornment."
            adornment={<Badge color="gray" variant="soft" label="New" />}
          />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="md" weight="semibold">
          Inside a Checkbox label
        </Text>
        <Text size="sm" color="text-low">
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
                adornment={<Badge color="gray" variant="soft" label="New" />}
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
