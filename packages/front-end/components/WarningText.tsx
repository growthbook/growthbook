import Link from "@/ui/Link";

// Only http(s) targets, so a warning can't smuggle in a javascript: URL.
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;

// Renders `[text](https://…)` Markdown links in a warning; the rest stays plain text.
export default function WarningText({ text }: { text: string }) {
  // split() with two capture groups yields [text, label, url, text, label, url, …].
  const parts = text.split(MARKDOWN_LINK);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 3 === 0) return part;
        if (i % 3 === 2) return null;
        return (
          <Link key={i} href={parts[i + 1]} external>
            {part}
          </Link>
        );
      })}
    </>
  );
}
