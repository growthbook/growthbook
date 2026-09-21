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
import styles from "./RichTextEditor.module.scss";

export interface LinkTarget {
  /** Where to float the card. Viewport coordinates. */
  rect: DOMRect;
  title: string;
  url: string;
  /** The link being edited, if there already is one. */
  node: LinkNode | null;
  /** What was selected when the card opened. Focus moves to the fields, so the
   *  live selection is no longer the one the link should replace. */
  selection: RangeSelection | null;
  /** Hovering shows the address; editing shows the fields. */
  mode: "preview" | "edit";
}

/** A bare domain or address, with or without a scheme. */
const URL_LIKE = /^(https?:\/\/\S+|(www\.)?[\w-]+(\.[\w-]+)+([/?#]\S*)?)$/i;

/**
 * Treats a link-shaped selection as the destination, so selecting an address
 * and reaching for the link button fills the URL in rather than asking twice.
 */
export function urlFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed) || !URL_LIKE.test(trimmed)) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Reads whatever link a selection or an element sits in, so the toolbar
 * button, a hover and a click all open the same card with the same content.
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
      const selected = selection.getTextContent();
      target = {
        rect,
        mode: "edit",
        selection: selection.clone(),
        node: $isLinkNode(link) ? link : null,
        url: $isLinkNode(link) ? link.getURL() : urlFromText(selected),
        title: $isLinkNode(link) ? link.getTextContent() : selected,
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
      if (!$isLinkNode(link)) return;
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

/**
 * A card floating under a link: its address on hover, its address and title
 * when editing. Edits land as you leave, so there is nothing to confirm.
 */
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

  // Apply through a ref so dismissing always commits the latest values,
  // whatever re-rendered in between.
  const commit = useRef(() => undefined as void);
  commit.current = () => {
    const nextUrl = url.trim();
    if (!nextUrl || (nextUrl === target.url && title.trim() === target.title)) {
      return;
    }
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
      // Type the title in, then link what was typed. Building a link node and
      // inserting it duplicated its text, whichever insert was used.
      selection.insertText(nextTitle);
      const caret = selection.anchor;
      selection.anchor.set(
        caret.key,
        Math.max(0, caret.offset - nextTitle.length),
        caret.type,
      );
      $toggleLink(nextUrl);
    });
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

  // Enter and the popover's own dismissal both close the card, and applying
  // twice would insert the link twice.
  const finished = useRef(false);
  const close = (commitFirst: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commitFirst) commit.current();
    onClose();
  };

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    }
    if (e.key === "Escape") onClose();
  };

  return (
    <Popover
      open
      onOpenChange={(open) => !open && close(editing)}
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
                {/* A quiet secondary action, not a peer of the fields above. */}
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
