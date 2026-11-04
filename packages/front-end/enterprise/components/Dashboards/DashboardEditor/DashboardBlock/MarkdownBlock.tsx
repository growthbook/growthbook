import type { MarkdownBlockInterface } from "shared/enterprise";
import Markdown from "@/components/Markdown/Markdown";
import type { BlockProps } from ".";

export default function MarkdownBlock({
  block,
}: BlockProps<MarkdownBlockInterface>) {
  return <Markdown>{block.content || ""}</Markdown>;
}
