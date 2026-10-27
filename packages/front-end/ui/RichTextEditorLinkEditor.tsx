import { useRef, useState } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { PiGlobeSimpleBold, PiTrashBold } from "react-icons/pi";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, $toggleLink, LinkNode } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type RangeSelection,
} from "lexical";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import TextField from "@/ui/TextField";
import Text from "@/ui/Text";
import { urlFromText } from "./RichTextEditorAutoLink";
import styles from "./RichTextEditor.module.scss";

export interface LinkTarget {
  /** Where to float the card. Viewport coordinates. */
  rect: DOMRect;
  title: string;
  url: string;
  /** The link being edited, if there already is one. */
  node: LinkNode | null;
  // The selection when the card opened; focus then moves to its fields, so the
  // live selection is no longer the one the link replaces.
  selection: RangeSelection | null;
  /** Hovering shows the address; editing shows the fields. */
  mode: "preview" | "edit";
}

// Inserted text merges into the text around it, so select just what was
// inserted, ready to link.
export function $insertTextSelected(selection: RangeSelection, text: string) {
  selection.insertText(text);
  const caret = selection.anchor;
  selection.anchor.set(
    caret.key,
    Math.max(0, caret.offset - text.length),
    caret.type,
  );
}

// The link a selection or element sits in, so the toolbar button and a hover
// open the same card.
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
      const selected = selection.getTextContent();
      target = {
        rect,
        mode: "edit",
        selection: selection.clone(),
        node: link,
        // A selected address fills the URL in, rather than asking twice.
        url: link ? link.getURL() : urlFromText(selected),
        title: link ? link.getTextContent() : selected,
      };
    });
    return target;
  };

  const fromElement = (
    element: HTMLElement,
    mode: LinkTarget["mode"],
  ): LinkTarget | null => {
    let target: LinkTarget | null = null;
    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(element);
      const link = node && $findMatchingParent(node, $isLinkNode);
      if (!link) return;
      target = {
        rect: element.getBoundingClientRect(),
        mode,
        selection: null,
        node: link,
        url: link.getURL(),
        title: link.getTextContent(),
      };
    });
    return target;
  };

  return { fromSelection, fromElement };
}

// A card under a link: its address on hover, address and title fields when
// editing. Edits apply on leaving the card.
export default function RichTextEditorLinkEditor({
  target,
  onEdit,
  onClose,
}: {
  target: LinkTarget;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [title, setTitle] = useState(target.title);
  const [url, setUrl] = useState(target.url);
  const editing = target.mode === "edit";

  // A ref, so dismissing always commits the latest values.
  const commit = useRef<() => void>(() => undefined);
  commit.current = () => {
    const typedUrl = url.trim();
    if (
      !typedUrl ||
      (typedUrl === target.url && title.trim() === target.title)
    ) {
      return;
    }
    // Without a scheme a domain would save as a path relative to the page.
    const nextUrl = urlFromText(typedUrl) || typedUrl;
    const nextTitle = title.trim() || nextUrl;

    editor.update(() => {
      if (target.node) {
        target.node.setURL(nextUrl);
        if (target.node.getTextContent() !== nextTitle) {
          target.node.clear();
          target.node.append($createTextNode(nextTitle));
        }
        return;
      }
      if (target.selection) $setSelection(target.selection.clone());
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // Insert the title as text, then link it: inserting a built link node
      // would duplicate its text.
      $insertTextSelected(selection, nextTitle);
      $toggleLink(nextUrl);
    });
  };

  // Enter and the popover's own dismissal both close the card, and applying
  // twice would insert the link twice.
  const finished = useRef(false);
  const close = (commitFirst: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commitFirst) commit.current();
    onClose();
  };

  const remove = () => {
    finished.current = true;
    editor.update(() => {
      const node = target.node;
      if (!node) return;
      node.getChildren().forEach((child) => node.insertBefore(child));
      node.remove();
    });
    onClose();
    editor.focus();
  };

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    }
  };

  // Radix reports outside clicks and focus here before dismissing, and
  // Escape not at all: only leaving the card saves, Escape discards.
  const leftCard = useRef(false);

  return (
    <Popover
      open
      onOpenChange={(open) => !open && close(editing && leftCard.current)}
      onInteractOutside={() => {
        leftCard.current = true;
      }}
      anchorOnly
      triggerAsChild
      side="bottom"
      align="start"
      showArrow={false}
      // The preview is a hover affordance, so it must not take focus: doing so
      // leaves Edit looking pressed when the card reopens.
      onOpenAutoFocus={editing ? undefined : (e) => e.preventDefault()}
      contentStyle={
        editing ? { padding: "12px", minWidth: 320 } : { padding: "4px" }
      }
      trigger={
        // A stand-in for the link itself, so Radix positions against it.
        <div
          style={{
            position: "fixed",
            top: target.rect.top,
            left: target.rect.left,
            width: target.rect.width,
            height: target.rect.height,
            pointerEvents: "none",
          }}
        />
      }
      content={
        editing ? (
          <Flex direction="column" gap="3" data-link-card="">
            <TextField
              size="sm"
              labelSize="sm"
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              autoFocus={!target.node}
              onKeyDown={onFieldKeyDown}
            />
            <TextField
              size="sm"
              labelSize="sm"
              label="Link title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Link title"
              autoFocus={!!target.node}
              onKeyDown={onFieldKeyDown}
            />
            {target.node ? (
              <>
                <Separator size="4" />
                <Flex justify="start">
                  <Button
                    size="sm"
                    variant="ghost"
                    color="gray"
                    onClick={remove}
                  >
                    <PiTrashBold size={13} /> Remove link
                  </Button>
                </Flex>
              </>
            ) : null}
          </Flex>
        ) : (
          <Flex align="center" gap="2" pl="2" data-link-card="">
            <PiGlobeSimpleBold size={14} className={styles.linkPreviewIcon} />
            <span className={styles.linkPreviewUrl}>
              <Text size="sm" color="text-mid">
                {target.url}
              </Text>
            </span>
            <Button size="sm" variant="ghost" color="gray" onClick={onEdit}>
              Edit
            </Button>
          </Flex>
        )
      }
    />
  );
}
