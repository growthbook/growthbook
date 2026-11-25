import { BsFlag, BsCodeSlash, BsHouse } from "react-icons/bs";
import { PiShieldCheck } from "react-icons/pi";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  GBDatabase,
  GBExperiment,
  GBLibrary,
  GBProductAnalytics,
  GBSettings,
} from "@/components/Icons";
import { isInterleavingEnabled } from "@/services/interleaving";
import type { SidebarLinkFilterProps, SidebarLinkProps } from "./SidebarLink";
import styles from "./Layout.module.scss";

export const navlinks: SidebarLinkProps[] = [
  {
    name: msg`Home`,
    href: "/",
    Icon: BsHouse,
    path: /^$/,
    className: styles.first,
  },
  {
    name: msg`Features`,
    href: "/features",
    Icon: BsFlag,
    path: /^(features|constants|configs)/,
    // Clicking the parent navigates to Feature Flags and expands, so the first
    // sub-link is pre-selected.
    navigateOnExpand: true,
    subLinks: [
      {
        name: msg`Feature Flags`,
        href: "/features",
        path: /^features/,
      },
      {
        name: msg`Configs`,
        href: "/configs",
        path: /^configs/,
        beta: true,
      },
      {
        name: msg`Constants`,
        href: "/constants",
        path: /^constants/,
      },
    ],
  },
  {
    name: msg`Experimentation`,
    href: "/experiments",
    path: /^(experiments|experiment\/|bandit|contextual-bandit|namespaces|power-calculator)/,
    Icon: GBExperiment,
    navigateOnExpand: true,
    subLinks: [
      {
        name: msg`Experiments`,
        href: "/experiments",
        path: /^(experiments(\/(?!templates|explore)|$)|experiment\/)/,
      },
      {
        name: msg`Bandits`,
        href: "/bandits",
        path: /^bandits?($|\/)/,
      },
      {
        name: msg`Contextual Bandits`,
        href: "/contextual-bandits",
        path: /^contextual-bandits?($|\/)/,
        // Default ON; the remote flag only turns this off for specific orgs.
        filter: ({ gb }) =>
          gb?.getFeatureValue("contextual-bandits", true) ?? true,
      },
      {
        name: msg`Interleaving`,
        href: "/interleavings",
        path: /^interleavings?($|\/)/,
        filter: ({ gb }) => isInterleavingEnabled(gb),
        beta: true,
      },
      {
        name: msg`Holdouts`,
        href: "/holdouts",
        path: /^holdouts/,
      },
      {
        name: msg`Templates`,
        href: "/experiments/templates",
        path: /^experiments\/templates/,
      },
      {
        name: msg`Power Calculator`,
        href: "/power-calculator",
        path: /^power-calculator/,
      },
      {
        name: msg`Namespaces`,
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
    name: msg`Product Analytics`,
    href: "/product-analytics/explore",
    path: /^(product-analytics|sql-explorer|session-replay)/,
    Icon: GBProductAnalytics,
    subLinks: [
      {
        name: msg`Explore`,
        href: "/product-analytics/explore",
        path: /^product-analytics\/explore(\/(?!funnel|journey|sql).*)?$/,
      },
      {
        name: msg`Funnels`,
        href: "/product-analytics/explore/funnel",
        path: /^product-analytics\/explore\/funnel/,
      },
      {
        name: msg`User Journeys`,
        href: "/product-analytics/explore/journey",
        path: /^product-analytics\/explore\/journey/,
        beta: true,
      },
      {
        name: msg`SQL Explorer`,
        href: "/product-analytics/explore/sql",
        path: /^product-analytics\/explore\/sql/,
      },
      {
        name: msg`Dashboards`,
        href: "/product-analytics/dashboards",
        path: /^product-analytics\/dashboards/,
      },
      {
        name: msg`Session Replay`,
        href: "/session-replay",
        path: /^session-replay/,
        beta: true,
        filter: ({ gb }) => !!gb?.isOn("session-replays"),
      },
    ],
  },
  {
    name: msg`Metrics and Data`,
    href: "/metrics",
    path: /^(metric\/|metrics|segment|dimension|datasources|fact-|metric-group|populations)/,
    autoClose: true,
    Icon: GBDatabase,
    subLinks: [
      {
        name: msg`Metrics`,
        href: "/metrics",
        path: /^(metric\/|metrics|fact-metric|metric-group)/,
      },
      {
        name: msg`Fact Tables`,
        href: "/fact-tables",
        path: /^fact-tables/,
      },
      {
        name: msg`Populations`,
        href: "/populations",
        path: /^populations/,
        filter: ({ gb }) => !!gb?.isOn("populations"),
      },
      {
        name: msg`Segments`,
        href: "/segments",
        path: /^segment/,
        filter: ({ segments }) => segments.length > 0,
      },
      {
        name: msg`Dimensions`,
        href: "/dimensions",
        path: /^dimension/,
      },
      {
        name: msg`Data Sources`,
        href: "/datasources",
        path: /^datasources/,
      },
    ],
  },
  {
    name: msg`Insights`,
    href: "/dashboard",
    Icon: GBLibrary,
    path: /^(dashboard|learnings|timeline|metric-effect|correlations|presentation)/,
    subLinks: [
      {
        name: msg`Dashboard`,
        href: "/dashboard",
        path: /^dashboard/,
      },
      {
        name: msg`Learnings`,
        href: "/learnings",
        path: /^learnings/,
      },
      {
        name: msg`Timeline`,
        href: "/timeline",
        path: /^(timeline)/,
      },
      // {
      //   name: "Interaction Effects",
      //   href: "/interactions",
      //   path: /^(interaction)/,
      // },
      {
        name: msg`Metric Effects`,
        href: "/metric-effects",
        path: /^(metric-effect)/,
      },
      {
        name: msg`Metric Correlations`,
        href: "/correlations",
        path: /^(correlations)/,
      },
      {
        name: msg`Presentations`,
        href: "/presentations",
        path: /^presentation/,
      },
    ],
  },
  {
    name: msg`SDK Configuration`,
    href: "/sdks",
    path: /^(attributes|environments|saved-groups|sdks|archetypes)/,
    autoClose: true,
    Icon: BsCodeSlash,
    subLinks: [
      {
        name: msg`SDK Connections`,
        href: "/sdks",
        path: /^sdks/,
      },
      {
        name: msg`Attributes`,
        href: "/attributes",
        path: /^attributes/,
      },
      {
        name: msg`Environments`,
        href: "/environments",
        path: /^environments/,
      },
      {
        name: msg`Saved Groups`,
        href: "/saved-groups",
        path: /^saved-groups/,
      },
      {
        name: msg`Archetypes`,
        href: "/archetypes",
        path: /^archetypes/,
      },
      {
        name: msg`Exposures Debugger`,
        href: "/exposure-debugger",
        path: /^exposure-debugger/,
      },
    ],
  },
  {
    name: msg`Settings`,
    href: "/settings",
    Icon: GBSettings,
    path: /^(settings|projects?|integrations|events|importing)/,
    autoClose: true,
    hideSubLinks: true,
    subLinks: [
      {
        name: msg`General`,
        href: "/settings",
        path: /^settings$/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings(),
      },
      {
        name: msg`Projects`,
        href: "/projects",
        path: /^project/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canViewProjectsPage(),
      },
      {
        name: msg`Members`,
        href: "/settings/team",
        path: /^settings\/team/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageTeam(),
      },
      {
        name: msg`Tags`,
        href: "/settings/tags",
        path: /^settings\/tags/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canCreateAndUpdateTag() ||
          permissionsUtils.canDeleteTag(),
      },
      {
        name: msg`Custom Fields`,
        href: "/settings/customfields",
        path: /^settings\/customfields/,
      },
      {
        name: msg`API Keys`,
        href: "/settings/keys",
        path: /^settings\/keys/,
        filter: ({ permissionsUtils }) => permissionsUtils.canViewApiKeys(),
      },
      {
        name: msg`Manage PATs`,
        href: "/settings/personal-access-tokens",
        path: /^settings\/personal-access-tokens/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageOrgSettings() ||
          permissionsUtils.canManagePersonalAccessTokens(),
      },
      {
        name: msg`Webhooks`,
        href: "/settings/webhooks",
        path: /^settings\/webhooks/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageSomeEventWebhooks(),
      },
      {
        name: msg`Events Log`,
        href: "/events",
        path: /^events/,
        filter: ({ permissionsUtils }) => permissionsUtils.canViewAuditLogs(),
      },
      {
        name: msg`Slack`,
        href: "/integrations/slack",
        path: /^integrations\/slack/,
        filter: ({ permissionsUtils }) =>
          permissionsUtils.canManageIntegrations(),
      },
      {
        // The importer lives in General; this reaches it for roles that can't see General.
        name: msg`Import Your Data`,
        href: "/importing",
        path: /^importing/,
        filter: ({ permissionsUtils }) =>
          !permissionsUtils.canManageOrgSettings() &&
          permissionsUtils.canViewFeatureModal() &&
          permissionsUtils.canCreateEnvironment({
            projects: [],
            id: "",
          }) &&
          permissionsUtils.canCreateProjects(),
      },
      {
        name: msg`Usage`,
        href: "/settings/usage",
        path: /^settings\/usage/,
        filter: ({ permissionsUtils, isCloud }) =>
          permissionsUtils.canViewUsage() && isCloud,
      },
      {
        name: msg`Custom Hooks`,
        href: "/settings/custom-hooks",
        path: /^settings\/custom-hooks/,
        filter: ({ permissionsUtils, isCloud }) =>
          !isCloud && permissionsUtils.canCreateCustomHook({ projects: [] }),
      },
      {
        name: msg`Billing`,
        href: "/settings/billing",
        path: /^settings\/billing/,
        filter: ({ permissionsUtils }) => permissionsUtils.canManageBilling(),
      },
    ],
  },
  {
    name: msg`Admin`,
    href: "/admin",
    Icon: PiShieldCheck,
    path: /^admin/,
    filter: ({ superAdmin, isMultiOrg }) => superAdmin && isMultiOrg,
  },
];

export const settingsNavLink = navlinks.find((l) => l.href === "/settings")!;

export function isSettingsRoute(route: string): boolean {
  return settingsNavLink.path.test(route.replace(/^\//, ""));
}

export type FlatNavItem = {
  name: MessageDescriptor;
  href: string;
  /** Top-level section label when this row is a child link */
  parentName?: MessageDescriptor;
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
