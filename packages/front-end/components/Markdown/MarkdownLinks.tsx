import Link from "@/ui/Link";
import { splitMarkdownLinks } from "./markdownLinkUtils";

// Renders `[text](https://…)` and `[text](/path)` Markdown links; the rest stays plain text.
export default function MarkdownLinks({ text }: { text: string }) {
  return (
    <>
      {splitMarkdownLinks(text).map((segment, i) =>
        typeof segment === "string" ? (
          segment
        ) : (
          <Link key={i} href={segment.href} external>
            {segment.label}
          </Link>
        ),
      )}
    </>
  );
}
