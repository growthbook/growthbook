import { ReactNode } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { ActionsOverlay } from "@/components/Features/CornerActions";
import cornerStyles from "@/components/Features/CornerActions.module.scss";
import Tooltip from "@/ui/Tooltip";
import { EditIcon } from "@/ui/ActionIcons";
import styles from "./EditableValueFrame.module.scss";

// Each button sits 4px inside the box; the offsets are net of a ghost
// button's negative margin.
const TALL_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: 5, right: 10 },
};
const ONE_LINE_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: {
    top: "50%",
    bottom: "auto",
    right: 10,
    transform: "translateY(-50%)",
  },
};
// Centred on the box, which sits its one line of code 1px high.
const ONE_LINE_CODE_ACTIONS: ActionsOverlay = {
  ...ONE_LINE_ACTIONS,
  style: { ...ONE_LINE_ACTIONS.style, top: "calc(50% + 2px)" },
};

// Put on an input that replaces a flush-framed value while it's edited.
export const inPlaceEditor = styles.inPlace;

// A value shown in a table cell, framed when it can be edited, with its copy,
// fullscreen and edit buttons revealed on hover. A tall value keeps its edit
// button at the top, apart from copy and fullscreen along the bottom; an empty
// one asks for a value, so its edit button always shows.
export default function EditableValueFrame({
  code,
  text = false,
  tall = false,
  empty = false,
  framed,
  flush = false,
  edit = null,
  children,
}: {
  // Shown as a code block, rather than centred on the line.
  code: boolean;
  // Plain text, set on the row's baseline.
  text?: boolean;
  tall?: boolean;
  empty?: boolean;
  framed: boolean;
  // The frame keeps to the value's column, with the value inset inside it,
  // rather than overhanging the column so the text lines up with it.
  flush?: boolean;
  edit?: {
    label: string;
    tooltip: string;
    onEdit: () => void;
    // Shown on the button instead of opening the editor.
    blockedReason?: string | null;
  } | null;
  children: (actions: {
    actionsOverlay: ActionsOverlay;
    extraActions: ReactNode;
  }) => ReactNode;
}) {
  const editButton = edit ? (
    <Tooltip content={edit.blockedReason ?? edit.tooltip}>
      <IconButton
        type="button"
        variant="ghost"
        radius="full"
        disabled={!!edit.blockedReason}
        onClick={edit.onEdit}
        aria-label={edit.label}
      >
        <EditIcon size="sm" />
      </IconButton>
    </Tooltip>
  ) : null;
  const ownButton = tall || empty;

  return (
    <Box
      className={clsx(
        styles.value,
        code ? styles.code : styles.centered,
        text && styles.text,
        framed && styles.frame,
        framed && flush && styles.flush,
        cornerStyles.hoverActions,
      )}
    >
      {children({
        actionsOverlay: tall
          ? TALL_ACTIONS
          : code
            ? ONE_LINE_CODE_ACTIONS
            : ONE_LINE_ACTIONS,
        extraActions: ownButton ? null : editButton,
      })}
      {editButton && ownButton ? (
        <Flex
          align="center"
          className={clsx(
            styles.openEditor,
            tall ? cornerStyles.actions : styles.openEditorCentered,
          )}
        >
          {editButton}
        </Flex>
      ) : null}
    </Box>
  );
}
