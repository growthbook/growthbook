import { FaDesktop, FaLink, FaRegFlag } from "react-icons/fa";

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
    header: "Linked Features",
  },
  "visual-editor": {
    header: "AI Visual Editor Changes",
  },
  redirects: {
    header: "URL Redirects",
  },
};

export type LinkedChange = keyof typeof LINKED_CHANGE_CONTAINER_PROPERTIES;
