import { FaDesktop, FaLink, FaRegFlag } from "react-icons/fa";
import { msg } from "@lingui/core/macro";

export const ICON_PROPERTIES = {
  "feature-flag": {
    color: "#6E56CF",
    component: FaRegFlag,
    radixColor: "indigo",
  },
  "visual-editor": {
    color: "#EBA600",
    component: FaDesktop,
    radixColor: "amber",
  },
  redirects: {
    color: "#11B081",
    component: FaLink,
    radixColor: "teal",
  },
} as const;

export const LINKED_CHANGE_CONTAINER_PROPERTIES = {
  "feature-flag": {
    addButtonCopy: msg`Add Feature Flag`,
  },
  "visual-editor": {
    addButtonCopy: msg`Add AI Visual Editor Change`,
  },
  redirects: {
    addButtonCopy: msg`Add URL Redirect`,
  },
};

export type LinkedChange = keyof typeof LINKED_CHANGE_CONTAINER_PROPERTIES;
