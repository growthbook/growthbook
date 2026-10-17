import { describe, expect, it } from "vitest";
import { createEditor } from "lexical";
import { AutoLinkNode, LinkNode, registerAutoLink } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  AUTO_LINK_TRANSFORMER,
  URL_MATCHERS,
} from "@/ui/RichTextEditorAutoLink";

const transformers = [AUTO_LINK_TRANSFORMER, ...TRANSFORMERS];

function roundTrip(markdown: string): string {
  const editor = createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
    ],
    onError: (e) => {
      throw e;
    },
  });
  registerAutoLink(editor, {
    matchers: URL_MATCHERS,
    changeHandlers: [],
    excludeParents: [],
  });
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(transformers));
}

describe("rich text bare URLs", () => {
  it("keeps a bare URL's underscores, saving it as an autolink", () => {
    expect(roundTrip("See https://example.com/foo_bar for details.")).toBe(
      "See <https://example.com/foo_bar> for details.",
    );
  });

  it("reads an autolink back as the same link", () => {
    expect(roundTrip("See <https://example.com/foo_bar>.")).toBe(
      "See <https://example.com/foo_bar>.",
    );
  });

  it("leaves a written link as it was", () => {
    expect(roundTrip("[the docs](https://example.com/foo_bar)")).toBe(
      "[the docs](https://example.com/foo_bar)",
    );
  });
});
