import { BsFlag, BsCodeSlash, BsHouse } from "react-icons/bs";
import {
  GBDatabase,
  GBExperiment,
  GBLibrary,
  GBProductAnalytics,
  GBSettings,
} from "@/components/Icons";
import type { SidebarLinkFilterProps, SidebarLinkProps } from "./SidebarLink";
import styles from "./Layout.module.scss";

export const navlinks: SidebarLinkProps[] = [
  {
    name: "Home",
    href: "/",
    Icon: BsHouse,
    path: /^$/,
    className: styles.first,
  },
  {
    name: "Features",
    href: "/features",
    Icon: BsFlag,
    path: /^(features|constants|configs)/,
    // Clicking the parent navigates to Feature Flags and expands, so the first
    // sub-link is pre-selected.
    navigateOnExpand: true,
    subLinks: [
      {
        name: "Feature Flags",
        href: "/features",
        path: /^features/,
      },
      {
        name: "Configs",
        href: "/configs",
        path: /^configs/,
        beta: true,
      },
      {
        name: "Constants",
        href: "/constants",
        path: /^constants/,
      },
    ],
  },
  {
    name: "Experimentation",
    href: "/experiments",
    path: /^(experiments|experiment\/|bandit|contextual-bandit|namespaces|power-calculator)/,
    Icon: GBExperiment,
    navigateOnExpand: true,
    subLinks: [
      {
        name: "Experiments",
        href: "/experiments",
        path: /^(experiments(\/(?!templates|explore)|$)|experiment\/)/,
      },
      {
        name: "Bandits",
        href: "/bandits",
        path: /^bandits?($|\/)/,
      },
      {
        name: "Contextual Bandits",
        href: "/contextual-bandits",
        path: /^contextual-bandits?($|\/)/,
        beta: true,
        filter: ({ gb }) => !!gb?.isOn("contextual-bandits"),
      },
      {
        name: "Holdouts",
        href: "/holdouts",
        path: /^holdouts/,
      },
      {
        name: "Templates",
        href: "/experiments/templates",
        path: /^experiments\/templates/,
      },
      {
        name: "Power Calculator",
        href: "/power-calculator",
        path: /^power-calculator/,
      },
      {
        name: "Namespaces",
        href: "/namespaces",
        path: /^namespaces/,
      },
      // {
      //   name: "Search",
      //   href: "/experiments/explore",
      //   path: /^experiments\/explore/,
      // },
    ],
  },
  {
    name: "Product Analytics",
    href: "/product-analytics/explore",
    path: /^(product-analytics|sql-explorer|session-replay)/,
    Icon: GBProductAnalytics,
    subLinks: [
      {
        name: "Explore",
        href: "/product-analytics/explore",
        path: /^product-analytics\/explore(\/(?!funnel).*)?$/,
      },
      {
        name: "Funnel Builder",
        href: "/product-analytics/explore/funnel",
        path: /^product-analytics\/explore\/funnel/,
      },
      {
        name: "SQL Reports",
        href: "/sql-explorer",
        path: /^sql-explorer/,
      },
      {
        name: "Dashboards",
        href: "/product-analytics/dashboards",
        path: /^product-analytics\/dashboards/,
      },
      {
        name: "Session Replay",
        href: "/session-replay",
        path: /^session-replay/,
        beta: true,
        filter: ({ gb }) => !!gb?.isOn("session-replays"),
      },
    ],
  },
  {
    name: "Metrics and Data",
    href: "/metrics",
    path: /^(metric\/|metrics|segment|dimension|datasources|fact-|metric-group)/,
    autoClose: true,
    Icon: GBDatabase,
    subLinks: [
      {
        name: "Metrics",
        href: "/metrics",
        path: /^(metric\/|metrics|fact-metric|metric-group)/,
      },
      {
        name: "Fact Tables",
        href: "/fact-tables",
        path: /^fact-tables/,
      },
      {
        name: "Segments",
        href: "/segments",
        path: /^segment/,
        filter: ({ segments }) => segments.length > 0,
      },
      {
        name: "Dimensions",
        href: "/dimensions",
        path: /^dimension/,
      },
      {
        name: "Data Sources",
        href: "/datasources",
        path: /^datasources/,
      },
    ],
  },
  {
    name: "Insights",
    href: "/dashboard",
    Icon: GBLibrary,
    path: /^(dashboard|learnings|timeline|metric-effect|correlations|presentation)/,
    subLinks: [
      {
        name: "Dashboard",
        href: "/dashboard",
        path: /^dashboard/,
      },
      {
        name: "Learnings",
        href: "/learnings",
        path: /^learnings/,
      },
      {
        name: "Timeline",
        href: "/timeline",
        path: /^(timeline)/,
      },
      // {
      //   name: "Interaction Effects",
      //   href: "/interactions",
      //   path: /^(interaction)/,
      // },
      {
        name: "Metric Effects",
        href: "/metric-effects",
        path: /^(metric-effect)/,
      },
      {
        name: "Metric Correlations",
        href: "/correlations",
        path: /^(correlations)/,
      },
      {
        name: "Presentations",
        href: "/presentations",
        path: /^presentation/,
      },
    ],
  },
  {
    name: "SDK Configuration",
    href: "/sdks",
    path: /^(attributes|environments|saved-groups|sdks|archetypes)/,
    autoClose: true,
    Icon: BsCodeSlash,
    subLinks: [
      {
        name: "SDK Connections",
        href: "/sdks",
        path: /^sdks/,
      },
      {
        name: "Attributes",
        href: "/attributes",
        path: /^attributes/,
      },
      {
        name: "Environments",
        href: "/environments",
        path: /^environments/,
      },
      {
        name: "Saved Groups",
        href: "/saved-groups",
        path: /^saved-groups/,
      },
      {
        name: "Archetypes",
        href: "/archetypes",
        path: /^archetypes/,
      },
      {
        name: "Exposures Debugger",
        href: "/exposure-debugger",
        path: /^exposure-debugger/,
      },
    ],
  },
  {
    name: "Settings",
    href: "/settings",
    Icon: GBSettings,
    path: /^(settings|admin|projects|integrations)/,
    autoClose: true,
    subLinks: [
      {
        name: "General",
        href: "/settings",
        path: /^settings$/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings(),
      },
      {
        name: "Members",
        href: "/settings/team",
        path: /^settings\/team/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageTeam(),
      },
      {
        name: "SSO",
        href: "/settings/sso",
        path: /^settings\/sso/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings(),
      },
      {
        name: "Tags",
        href: "/settings/tags",
        path: /^settings\/tags/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateAndUpdateTag() ||
          permissionsUtils.canDeleteTag(),
      },
      {
        name: "Projects",
        href: "/projects",
        path: /^project/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canViewProjectsPage(),
      },
      {
        name: "Custom Fields",
        href: "/settings/customfields",
        path: /^settings\/customfields/,
      },
      {
        name: "Custom Markdown",
        href: "/settings/custom-markdown",
        path: /^settings\/custom-markdown/,
      },
      {
        name: "API Keys",
        href: "/settings/keys",
        path: /^settings\/keys/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateApiKey() ||
          permissionsUtils.canDeleteApiKey(),
      },
      {
        name: "Webhooks",
        href: "/settings/webhooks",
        path: /^settings\/webhooks/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canViewEventWebhook(),
      },
      {
        name: "Logs",
        href: "/events",
        path: /^events/,
        filter: ({ permissionsUtils }) => permissionsUtils.canViewAuditLogs(),
      },
      {
        name: "Slack",
        href: "/integrations/slack",
        path: /^integrations\/slack/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageIntegrations(),
      },
      {
        name: "Import your data",
        href: "/importing",
        path: /^importing/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canViewFeatureModal() &&
          permissionsUtils.canCreateEnvironment({
            projects: [],
            id: "",
          }) &&
          permissionsUtils.canCreateProjects(),
      },
      {
        name: "Usage",
        href: "/settings/usage",
        path: /^settings\/usage/,
        filter: ({ permissionsUtils, isCloud }) =>
          permissionsUtils.canViewUsage() && isCloud,
      },
      {
        name: "Custom Hooks",
        href: "/settings/custom-hooks",
        path: /^settings\/custom-hooks/,
        filter: ({ permissionsUtils, isCloud }) =>
          !isCloud && permissionsUtils.canCreateCustomHook({ projects: [] }),
      },
      {
        name: "Billing",
        href: "/settings/billing",
        path: /^settings\/billing/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageBilling(),
      },
      {
        name: "Admin",
        href: "/admin",
        path: /^admin/,
        divider: true,
        filter: ({ superAdmin, isMultiOrg }) => superAdmin && isMultiOrg,
      },
    ],
  },
];

export type FlatNavItem = {
  name: string;
  href: string;
  /** Top-level section label when this row is a child link */
  parentName?: string;
};

/**
 * Linear list of sidebar destinations for search (e.g. Cmd+K), using the same
 * filter rules as {@link SidebarLink}: parent hidden if its filter fails; if it
 * has subLinks, hidden when no child passes filter (same as empty permittedSubLinks).
 *
 * Parent section rows (e.g. "Experimentation", "SDK Configuration") are omitted;
 * only standalone top-level links and permitted children are included.
 */
export function flattenNavItems(
  links: SidebarLinkProps[],
  filterProps: SidebarLinkFilterProps,
): FlatNavItem[] {
  const out: FlatNavItem[] = [];

  for (const link of links) {
    if (link.filter && !link.filter(filterProps)) {
      continue;
    }

    const subLinks = link.subLinks ?? [];
    const permitted = subLinks.filter(
      (l) => !l.filter || l.filter(filterProps),
    );

    if (subLinks.length > 0 && permitted.length === 0) {
      continue;
    }

    if (subLinks.length === 0) {
      out.push({ name: link.name, href: link.href });
    } else {
      for (const child of permitted) {
        out.push({
          name: child.name,
          href: child.href,
          parentName: link.name,
        });
      }
    }
  }

  return out;
}
