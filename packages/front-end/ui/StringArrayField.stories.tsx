import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import StringArrayField from "./StringArrayField";

export const meta: StoryMeta = {
  name: "StringArrayField",
  category: "inputs",
  status: "stable",
  summary:
    "Creatable input that turns typed or pasted text into a list of string chips, with an optional raw text mode.",
  useWhen: [
    "Entering a free-form list of values such as IDs, tags, or keys.",
    "Pasting a delimited list that should split into items.",
  ],
  avoidWhen: [
    {
      reason: "Values must come from a fixed option list.",
      use: "MultiSelectField",
    },
    {
      reason: "A single value.",
      use: "TextField",
    },
  ],
  related: ["MultiSelectField", "TextField"],
};

export default function StringArrayFieldStories() {
  const [values, setValues] = useState<string[]>(["alpha", "beta"]);
  const [ids, setIds] = useState<string[]>(["user_1", "user_2", "user_3"]);
  return (
    <Flex direction="column" gap="3" maxWidth="480px">
      <StringArrayField
        label="Tags"
        value={values}
        onChange={setValues}
        placeholder="Type and press Enter..."
      />
      <StringArrayField
        label="IDs"
        value={ids}
        onChange={setIds}
        enableRawTextMode
        showCopyButton
        size="lg"
      />
    </Flex>
  );
}
