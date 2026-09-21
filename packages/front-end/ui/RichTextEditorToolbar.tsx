import { useCallback, useEffect, useState } from "react";
import { Flex, IconButton, Separator } from "@radix-ui/themes";
import {
  PiCodeBold,
  PiImageBold,
  PiLinkBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiQuotesBold,
  PiTextBBold,
  PiTextHOneBold,
  PiTextHThreeBold,
  PiTextHTwoBold,
  PiTextItalicBold,
  PiTextStrikethroughBold,
} from "react-icons/pi";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingTagType,
} from "@lexical/rich-text";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $isLinkNode } from "@lexical/link";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type ElementNode,
  TextFormatType,
} from "lexical";
import Tooltip from "@/ui/Tooltip";
import RichTextEditorLinkEditor, {
  LinkTarget,
  useLinkTarget,
} from "./RichTextEditorLinkEditor";
import styles from "./RichTextEditor.module.scss";

/** Which controls are lit for the current selection. */
interface ActiveState {
  formats: Set<TextFormatType>;
  block: string;
  /** URL of the link the caret sits in, or null when it is not in one. */
  linkUrl: string | null;
}

const TEXT_FORMATS: {
  format: TextFormatType;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}[] = [
  { format: "bold", label: "Bold", Icon: PiTextBBold },
  { format: "italic", label: "Italic", Icon: PiTextItalicBold },
  {
    format: "strikethrough",
    label: "Strikethrough",
    Icon: PiTextStrikethroughBold,
  },
  { format: "code", label: "Inline code", Icon: PiCodeBold },
];

const HEADINGS: {
  tag: HeadingTagType;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}[] = [
  { tag: "h1", label: "Heading 1", Icon: PiTextHOneBold },
  { tag: "h2", label: "Heading 2", Icon: PiTextHTwoBold },
  { tag: "h3", label: "Heading 3", Icon: PiTextHThreeBold },
];

export default function RichTextEditorToolbar({
  onPickImage,
}: {
  /** Omit to leave the image button out. */
  onPickImage?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<ActiveState>({
    formats: new Set(),
    block: "paragraph",
    linkUrl: null,
  });

  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const { fromSelection, fromElement } = useLinkTarget();

  const readSelection = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    const formats = new Set<TextFormatType>();
    (["bold", "italic", "strikethrough", "code"] as TextFormatType[]).forEach(
      (f) => {
        if (selection.hasFormat(f)) formats.add(f);
      },
    );

    const anchorNode = selection.anchor.getNode();
    const block =
      anchorNode.getKey() === "root"
        ? anchorNode
        : ($findMatchingParent(
            anchorNode,
            (n) => !n.getParent() || $isRootOrShadowRoot(n.getParent()),
          ) ?? anchorNode.getTopLevelElementOrThrow());

    let blockType = "paragraph";
    if ($isHeadingNode(block)) blockType = block.getTag();
    else if ($isQuoteNode(block)) blockType = "quote";
    else if ($isListNode(block)) {
      blockType = (block as ListNode).getListType() === "number" ? "ol" : "ul";
    }

    setActive({
      formats,
      block: blockType,
      linkUrl: (() => {
        const link = $findMatchingParent(anchorNode, $isLinkNode);
        return link && $isLinkNode(link) ? link.getURL() : null;
      })(),
    });
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) =>
          editorState.read(readSelection),
        ),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            readSelection();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, readSelection],
  );

  const setBlock = (make: null | (() => ElementNode)) =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, make ?? $createParagraphNode);
    });

  const toggleHeading = (tag: HeadingTagType) =>
    setBlock(active.block === tag ? null : () => $createHeadingNode(tag));

  const toggleList = (type: "ul" | "ol") => {
    if (active.block === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }
    editor.dispatchCommand(
      type === "ul"
        ? INSERT_UNORDERED_LIST_COMMAND
        : INSERT_ORDERED_LIST_COMMAND,
      undefined,
    );
  };

  // Clicking a link opens the same editor the toolbar button does, rather than
  // following it out of the page.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      e.preventDefault();
      setLinkTarget(fromElement(anchor as HTMLElement));
    };
    return editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener("click", onClick);
      root?.addEventListener("click", onClick);
    });
  }, [editor, fromElement]);

  const button = (
    key: string,
    label: string,
    on: boolean,
    onClick: () => void,
    Icon: React.ComponentType<{ size?: number }>,
  ) => (
    <Tooltip key={key} content={label}>
      <IconButton
        size="1"
        variant={on ? "soft" : "ghost"}
        color={on ? undefined : "gray"}
        aria-label={label}
        aria-pressed={on}
        // Keep focus in the text: the command acts on the live selection.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={styles.toolbarButton}
      >
        <Icon size={15} />
      </IconButton>
    </Tooltip>
  );

  return (
    <Flex className={styles.toolbar} align="center" gap="1" wrap="wrap">
      {TEXT_FORMATS.map(({ format, label, Icon }) =>
        button(
          format,
          label,
          active.formats.has(format),
          () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
          Icon,
        ),
      )}

      <Separator orientation="vertical" size="1" />

      {HEADINGS.map(({ tag, label, Icon }) =>
        button(
          tag,
          label,
          active.block === tag,
          () => toggleHeading(tag),
          Icon,
        ),
      )}

      <Separator orientation="vertical" size="1" />

      {button(
        "ul",
        "Bulleted list",
        active.block === "ul",
        () => toggleList("ul"),
        PiListBulletsBold,
      )}
      {button(
        "ol",
        "Numbered list",
        active.block === "ol",
        () => toggleList("ol"),
        PiListNumbersBold,
      )}
      {button(
        "quote",
        "Quote",
        active.block === "quote",
        () => setBlock(active.block === "quote" ? null : $createQuoteNode),
        PiQuotesBold,
      )}

      <Separator orientation="vertical" size="1" />

      {button(
        "link",
        linkTarget?.node ? "Edit link" : "Link",
        !!active.linkUrl,
        () => setLinkTarget(fromSelection()),
        PiLinkBold,
      )}

      {onPickImage
        ? button("image", "Insert image", false, onPickImage, PiImageBold)
        : null}

      {linkTarget ? (
        <RichTextEditorLinkEditor
          target={linkTarget}
          onClose={() => setLinkTarget(null)}
        />
      ) : null}
    </Flex>
  );
}
