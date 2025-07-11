import { MarkdownBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import Markdown from "@/components/Markdown/Markdown";
import { BlockProps } from ".";

export default function MarkdownBlock({
  block,
}: BlockProps<MarkdownBlockInterface>) {
  return <Markdown>{block.content || ""}</Markdown>;
}
