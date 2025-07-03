import { MarkdownBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import Markdown from "@/components/Markdown/Markdown";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { BlockProps } from ".";

export default function MarkdownBlock({
  block,
  isEditing,
  setBlock,
}: BlockProps<MarkdownBlockInterface>) {
  if (isEditing) {
    return (
      <MarkdownInput
        value={block.content}
        setValue={(value) => setBlock({ ...block, content: value })}
      />
    );
  }
  return <Markdown>{block.content || ""}</Markdown>;
}
