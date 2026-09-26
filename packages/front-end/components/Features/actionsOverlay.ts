import { CSSProperties } from "react";

/** Where a value's action buttons (copy, fullscreen) sit over it. */
export type ActionsOverlay = {
  // Absolute offsets (and gap) against the value's box.
  style?: CSSProperties;
  // Hidden until the value is hovered or focused.
  revealOnHover?: boolean;
  // String only: the constant picker joins the actions.
  withConstantButton?: boolean;
};
