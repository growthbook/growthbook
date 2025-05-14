import Markdown from "@/components/Markdown/Markdown";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { Block } from "./index";

export default function MarkdownBlock({
  content,
  isEditing,
  setBlock,
}: {
  content: string;
  isEditing: boolean;
  setBlock: (block: Block) => void;
}) {
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
