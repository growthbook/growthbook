import { MarkdownBlockInterface } from "shared/enterprise";
import Markdown from "@/components/Markdown/Markdown";
import { BlockProps } from ".";

export default function MarkdownBlock({
  block,
}: BlockProps<MarkdownBlockInterface>) {
  return <Markdown>{block.content || ""}</Markdown>;
}
