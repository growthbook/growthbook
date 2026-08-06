import { MarkdownBlockInterface } from "shared/enterprise";
import Markdown from "@/components/Markdown/Markdown";
import { BlockProps } from ".";

export default function MarkdownBlock({
  block,
  isPublic,
  publicShareUid,
}: BlockProps<MarkdownBlockInterface>) {
  return (
    <Markdown
      isPublic={isPublic}
      shareUid={publicShareUid}
      shareType="dashboard"
    >
      {block.content || ""}
    </Markdown>
  );
}
