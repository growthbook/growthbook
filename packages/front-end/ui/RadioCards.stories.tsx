import { useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import RadioCards from "./RadioCards";
import Avatar from "./Avatar";

export default function RadioCardsStories() {
  const [radioCardSelected, setRadioCardSelected] = useState("");
  const [radioCardColumns, setRadioCardColumns] = useState<
    "1" | "2" | "3" | "4" | "5" | "6"
  >("1");

  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Configuration</Text>
      <SelectField
        label="Columns"
        value={radioCardColumns}
        options={[
          { label: "1", value: "1" },
          { label: "2", value: "2" },
          { label: "3", value: "3" },
          { label: "4", value: "4" },
          { label: "5", value: "5" },
          { label: "6", value: "6" },
        ]}
        sort={false}
        onChange={(v: "1" | "2" | "3" | "4" | "5" | "6") =>
          setRadioCardColumns(v)
        }
      />
      <Text weight="medium">Rendering</Text>
      <RadioCards
        columns={radioCardColumns}
        width={radioCardColumns === "1" ? "400px" : undefined}
        value={radioCardSelected}
        setValue={(v) => {
          setRadioCardSelected(v);
        }}
        options={[
          {
            value: "k1",
            label: "Radio Card 1",
          },
          {
            value: "k2",
            label: "Radio Card 2 with avatar",
            avatar: <Avatar radius="small">BF</Avatar>,
          },
          {
            value: "k3",
            label: "Radio Card 3, with description",
            description: "This is a description",
            avatar: (
              <Avatar radius="small">
                <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
              </Avatar>
            ),
          },
          {
            value: "k4",
            label: "Radio Card 4, disabled",
            description: "This is a description",
            disabled: true,
          },
          {
            value: "k5",
            label: "Radio Card 5, long title, long description",
            description:
              "This is a description. It is very long. It should wrap around without changing the width of the parent container.",
          },
          {
            value: "k6",
            label: (
              <PremiumTooltip
                // @ts-expect-error - fake feature that nobody has
                commercialFeature="unobtanium"
                body="This is an expensive popup message"
                usePortal={true}
              >
                Premium Card 6
              </PremiumTooltip>
            ),
            description: "You can't afford this",
          },
        ]}
      />
    </Flex>
  );
}
