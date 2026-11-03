import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import FileInput from "./FileInput";

export const meta: StoryMeta = {
  name: "FileInput",
  category: "inputs",
  status: "stable",
  summary: "Button-style file chooser that shows the selected file name.",
  useWhen: [
    "Uploading a single file from the user's machine, filtered by accept.",
  ],
  avoidWhen: [
    {
      reason: "Attaching images inside Markdown content.",
      use: "RichTextEditor",
    },
  ],
  related: ["TextField"],
};

export default function FileInputStories() {
  return (
    <Flex direction="column" gap="3" maxWidth="360px">
      <FileInput name="example" onChange={() => {}} />
      <FileInput
        name="required"
        required
        placeholder="Upload key file..."
        onChange={() => {}}
      />
    </Flex>
  );
}
