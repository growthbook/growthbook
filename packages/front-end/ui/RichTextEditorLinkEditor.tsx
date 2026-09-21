import { useEffect, useRef, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import Button from "@/ui/Button";
import TextField from "@/ui/TextField";
import styles from "./RichTextEditor.module.scss";

export interface LinkTarget {
  /** Where to float the card. Viewport coordinates. */
  rect: DOMRect;
  text: string;
  url: string;
  /** The link being edited, if the caret was already inside one. */
  node: LinkNode | null;
}

/**
 * Reads whatever link the selection is in, so the toolbar button and a click
 * on a link open the same editor with the same content.
 */
export function useLinkTarget() {
  const [editor] = useLexicalComposerContext();

  const fromSelection = (): LinkTarget | null => {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return null;
    const rect = domSelection.getRangeAt(0).getBoundingClientRect();

    let target: LinkTarget | null = null;
    editor.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const link = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
      target = {
        rect,
        node: $isLinkNode(link) ? link : null,
        url: $isLinkNode(link) ? link.getURL() : "",
        text: $isLinkNode(link)
          ? link.getTextContent()
          : selection.getTextContent(),
      };
    });
    return target;
  };

  const fromElement = (element: HTMLElement): LinkTarget | null => {
    let target: LinkTarget | null = null;
    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(element);
      const link = node && $findMatchingParent(node, $isLinkNode);
      if (!$isLinkNode(link)) return;
      target = {
        rect: element.getBoundingClientRect(),
        node: link,
        url: link.getURL(),
        text: link.getTextContent(),
      };
    });
    return target;
  };

  return { fromSelection, fromElement };
}

/** A floating card for adding or editing a link's text and URL. */
export default function RichTextEditorLinkEditor({
  target,
  onClose,
}: {
  target: LinkTarget;
  onClose: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [text, setText] = useState(target.text);
  const [url, setUrl] = useState(target.url);
  const card = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape, the way a popover would.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!card.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const apply = () => {
    const nextUrl = url.trim();
    if (!nextUrl) return;
    const nextText = text.trim() || nextUrl;

    editor.update(() => {
      if (target.node) {
        target.node.setURL(nextUrl);
        if (target.node.getTextContent() !== nextText) {
          target.node.clear();
          target.node.append($createTextNode(nextText));
        }
        return;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const link = $createLinkNode(nextUrl);
      link.append($createTextNode(nextText));
      // Replaces the selection, so the label wins over whatever was selected.
      selection.insertNodes([link]);
    });
    onClose();
    editor.focus();
  };

  const remove = () => {
    editor.update(() => {
      const node = target.node;
      if (!node) return;
      const children = node.getChildren();
      children.forEach((child) => node.insertBefore(child));
      node.remove();
    });
    onClose();
    editor.focus();
  };

  return (
    <div
      ref={card}
      className={styles.linkEditor}
      style={{ top: target.rect.bottom + 6, left: target.rect.left }}
    >
      <Flex direction="column" gap="2">
        <TextField
          label="Text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Link text"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <TextField
          label="URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <Flex gap="2" justify="end" align="center">
          {target.node ? (
            <Button variant="ghost" color="red" onClick={remove}>
              Remove
            </Button>
          ) : null}
          <Button variant="ghost" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!url.trim()} onClick={apply}>
            {target.node ? "Update" : "Add link"}
          </Button>
        </Flex>
      </Flex>
    </div>
  );
}
