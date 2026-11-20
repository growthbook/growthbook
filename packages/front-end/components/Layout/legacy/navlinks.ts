import { BsFlag, BsCodeSlash, BsHouse } from "react-icons/bs";
import { PiShieldCheck } from "react-icons/pi";
import {
  GBDatabase,
  GBExperiment,
  GBLibrary,
  GBProductAnalytics,
  GBSettings,
} from "@/components/Icons";
import { navlinks as sharedNavlinks } from "@/components/Layout/sidebarNav";
import type { SidebarLinkProps } from "./SidebarLink";
import styles from "./Layout.module.scss";

// The old sidebar's icons and behavior, which the shared navlinks don't carry.
const decoration: Record<
  string,
  Pick<
    SidebarLinkProps,
    "Icon" | "className" | "navigateOnExpand" | "autoClose" | "hideSubLinks"
  >
> = {
  Home: { Icon: BsHouse, className: styles.first },
  Features: { Icon: BsFlag, navigateOnExpand: true },
  Experimentation: { Icon: GBExperiment, navigateOnExpand: true },
  "Product Analytics": { Icon: GBProductAnalytics },
  "Metrics and Data": { Icon: GBDatabase, autoClose: true },
  Insights: { Icon: GBLibrary },
  "SDK Configuration": { Icon: BsCodeSlash, autoClose: true },
  Settings: { Icon: GBSettings, autoClose: true, hideSubLinks: true },
  Admin: { Icon: PiShieldCheck },
};

// main's matching, keyed "Section" or "Section/Item": the shared list also
// matches holdout and template pages (holdout/[hid], experiments/template/[tid]).
const mainPaths: Record<string, RegExp> = {
  Experimentation:
    /^(experiments|experiment\/|bandit|contextual-bandit|namespaces|power-calculator)/,
  "Experimentation/Experiments":
    /^(experiments(\/(?!templates|explore)|$)|experiment\/)/,
  "Experimentation/Holdouts": /^holdouts/,
  "Experimentation/Templates": /^experiments\/templates/,
};

export const navlinks: SidebarLinkProps[] = sharedNavlinks.map((link) => ({
  ...link,
  ...decoration[link.name],
  path: mainPaths[link.name] ?? link.path,
  subLinks: link.subLinks?.map((sub) => ({
    ...sub,
    path: mainPaths[`${link.name}/${sub.name}`] ?? sub.path,
  })),
}));
