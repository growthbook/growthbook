import { MarkdownBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import Markdown from "@/components/Markdown/Markdown";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { BlockProps } from ".";

export default function MarkdownBlock({
  content,
  isEditing,
  setBlock,
}: BlockProps<MarkdownBlockInterface>) {
  if (isEditing) {
    return (
      <MarkdownInput
        value={content}
        setValue={(value) => setBlock({ type: "markdown", content: value })}
      />
    );
  }
  return <Markdown>{content || ""}</Markdown>;
}
