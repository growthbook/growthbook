import { FaDesktop, FaLink, FaRegFlag } from "react-icons/fa";

export const ICON_PROPERTIES = {
  "feature-flag": {
    color: "#6E56CF",
    component: FaRegFlag,
  },
  "visual-editor": {
    color: "#EBA600",
    component: FaDesktop,
  },
  redirects: {
    color: "#11B081",
    component: FaLink,
  },
};

export const LINKED_CHANGE_CONTAINER_PROPERTIES = {
  "feature-flag": {
    header: "Linked Features",
    addButtonCopy: "Add Feature Flag",
  },
  "visual-editor": {
    header: "Visual Editor Changes",
    addButtonCopy: "Add Visual Editor Change",
  },
  redirects: {
    header: "URL Redirects",
    addButtonCopy: "Add URL Redirect",
  },
};

export type LinkedChange = keyof typeof LINKED_CHANGE_CONTAINER_PROPERTIES;
