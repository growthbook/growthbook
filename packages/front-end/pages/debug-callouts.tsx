import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { PiRocketLaunch, PiInfo } from "react-icons/pi";
import { Permissions } from "shared/permissions";
import Callout from "@/ui/Callout";
import { Status } from "@/ui/HelperText";
import PremiumCallout from "@/ui/PremiumCallout";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import UIText from "@/ui/Text";
import Link from "@/ui/Link";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import { UserContext } from "@/services/UserContext";
import DebugAllCalloutsGenerated, {
  generatedNavItems,
} from "@/components/DebugAllCalloutsGenerated";

function Example({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--gray-11)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </Box>
  );
}

const STATUSES: Status[] = ["wizard", "info", "warning", "error", "success"];
const SIZES = ["sm", "md"] as const;

const CANDIDATE_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 8,
};

type Section = {
  id: string;
  title: string;
  description?: React.ReactNode;
  render: () => React.ReactNode;
};

const sections: Section[] = [
  {
    id: "status",
    title: "Status",
    render: () => (
      <Flex direction="column" gap="3">
        {STATUSES.map((s) => (
          <Example key={s} label={`status="${s}"`}>
            <Callout status={s}>This is a &ldquo;{s}&rdquo; callout.</Callout>
          </Example>
        ))}
      </Flex>
    ),
  },
  {
    id: "size",
    title: "Size",
    render: () => (
      <Flex direction="column" gap="4">
        {SIZES.map((size) => (
          <Box key={size}>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              size=&quot;{size}&quot;
            </div>
            <Flex direction="column" gap="2">
              <Example label={`size="${size}" status="info"`}>
                <Callout status="info" size={size}>
                  This is an info callout at size &ldquo;{size}&rdquo;. It
                  contains a normal sentence of readable text.
                </Callout>
              </Example>
              <Example label={`size="${size}" status="error"`}>
                <Callout status="error" size={size}>
                  This is an error callout at size &ldquo;{size}&rdquo;. It
                  contains a normal sentence of readable text.
                </Callout>
              </Example>
            </Flex>
          </Box>
        ))}
      </Flex>
    ),
  },
  {
    id: "icon-variations",
    title: "Icon Variations",
    render: () => (
      <Flex direction="column" gap="3">
        <Example label="icon={undefined} (default status icon)">
          <Callout status="info">Default status icon (no icon prop).</Callout>
        </Example>
        <Example label="icon={null} (no icon)">
          <Callout status="info" icon={null}>
            No icon. The icon prop is null.
          </Callout>
        </Example>
        <Example label="icon={<PiRocketLaunch />} (custom icon)">
          <Callout status="info" icon={<PiRocketLaunch />}>
            Custom icon. PiRocketLaunch passed as the icon prop.
          </Callout>
        </Example>
        <Example label="icon={<PiInfo />} (another custom icon)">
          <Callout status="warning" icon={<PiInfo />}>
            Custom icon on a warning callout. PiInfo.
          </Callout>
        </Example>
      </Flex>
    ),
  },
  {
    id: "rich-content",
    title: "Rich Content (block children)",
    description: (
      <>
        Block-level children (headings, paragraphs, lists) render directly. No{" "}
        <code>contentsAs</code> prop needed. Mirrors the shape used in{" "}
        <code>ImportSettings.tsx</code>.
      </>
    ),
    render: () => (
      <Example label='status="info" with block children'>
        <Callout status="info">
          <h4 style={{ margin: "0 0 8px" }}>Import Settings</h4>
          <p style={{ margin: "0 0 6px" }}>
            Before importing, review the following checklist to ensure your
            configuration file is valid and compatible with your environment.
          </p>
          <p style={{ margin: "0 0 6px" }}>
            Incompatible settings will be skipped automatically; no existing
            configuration will be overwritten unless explicitly confirmed.
          </p>
          <ul style={{ margin: "0 0 6px", paddingLeft: 20 }}>
            <li>All required fields must be present.</li>
            <li>Feature flag rules must reference valid environments.</li>
            <li>Metric IDs must match existing fact tables.</li>
          </ul>
          <p style={{ margin: 0 }}>
            Run <code>validate-config --dry-run</code> to check for errors
            before applying.
          </p>
        </Callout>
      </Example>
    ),
  },
  {
    id: "content-patterns",
    title: "Content Patterns",
    description: "Real product shapes. One example each.",
    render: () => {
      const count = 3;
      return (
        <Flex direction="column" gap="3">
          <Example label="Plain text error">
            <Callout status="error">Failed to load dashboards.</Callout>
          </Example>

          <Example label="Text + inline DocLink">
            <Callout status="info">
              This data source supports auto-generated metrics.{" "}
              <DocLink docSection="config">Learn more</DocLink>
            </Callout>
          </Example>

          <Example label="Loading state (icon={<LoadingSpinner />})">
            <Callout status="info" size="sm" icon={<LoadingSpinner />}>
              Refreshing list&hellip;
            </Callout>
          </Example>

          <Example label="Dynamic interpolated text">
            <Callout status="warning">
              {count} metrics could not be generated.
            </Callout>
          </Example>

          <Example label="Long text wrapping">
            <Callout status="info">
              This experiment is currently in a draft state and has not yet been
              started. To begin collecting data, navigate to the experiment
              settings, confirm your targeting conditions, and click the
              &ldquo;Start Experiment&rdquo; button. Once started, results will
              begin to appear within 24 hours depending on your data warehouse
              sync schedule and the volume of incoming events.
            </Callout>
          </Example>
        </Flex>
      );
    },
  },
  {
    id: "action",
    title: "Action slot",
    description: (
      <>
        The <code>action</code> prop renders a right-aligned slot pinned to the
        first line of text, so callers stop hand-rolling the Flex +
        negative-margin pattern. Validates a Button, a non-button (Link), action
        combined with dismiss, and a multi-line case.
      </>
    ),
    render: () => (
      <Flex direction="column" gap="3">
        <Example label="action={<Button>Retry</Button>}">
          <Callout
            status="error"
            action={<Button variant="soft">Retry</Button>}
          >
            Something went wrong loading results.
          </Callout>
        </Example>

        <Example label={`action={<Button size="xs">Generate</Button>}`}>
          <Callout
            status="info"
            action={<Button variant="soft">Generate</Button>}
          >
            Before we can build tables, we need to scan your schema.
          </Callout>
        </Example>

        <Example label="action={<Link>Learn more</Link>} (non-button)">
          <Callout
            status="info"
            action={
              <Link href="#" onClick={(e) => e.preventDefault()}>
                Learn more
              </Link>
            }
          >
            A non-button action should stay vertically aligned with the text.
          </Callout>
        </Example>

        <Example label="action + dismissible together">
          <Callout
            status="warning"
            action={
              <Button variant="soft" size="xs">
                Fix
              </Button>
            }
            dismissible
            id="debug-action-dismiss"
            renderWhenDismissed={(undismiss) => (
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  undismiss();
                }}
              >
                Show again
              </Link>
            )}
          >
            An action and a dismiss button can now coexist.
          </Callout>
        </Example>

        <Example label="Multi-line content + action (action stays on first line)">
          <Callout
            status="info"
            action={
              <Button variant="soft" size="xs">
                Action
              </Button>
            }
          >
            This callout has a longer message that wraps across multiple lines,
            to verify the icon and the action button both stay aligned with the
            first line of text instead of centering on the whole block. The row
            should grow downward while the icon and button stay at the top.
          </Callout>
        </Example>
      </Flex>
    ),
  },
  {
    id: "action-color-inherit",
    title: "Action color (inherit escape hatch)",
    description: (
      <>
        <code>@/ui/Button</code> defaults to{" "}
        <code>color=&quot;violet&quot;</code> and always forces it, so an action
        button does not match a non-info callout. Pass{" "}
        <code>color=&quot;inherit&quot;</code> to drop the forced color so the
        button inherits the callout&apos;s accent. In each pair the first button
        is the default and the second is <code>color=&quot;inherit&quot;</code>.
      </>
    ),
    render: () => (
      <Flex direction="column" gap="3">
        {STATUSES.map((s) => (
          <Example
            key={s}
            label={`status="${s}": default (violet) vs color="inherit"`}
          >
            <Flex direction="column" gap="2">
              <Callout
                status={s}
                action={<Button variant="soft">Action</Button>}
              >
                Default action button.
              </Callout>
              <Callout
                status={s}
                action={
                  <Button variant="soft" color="inherit">
                    Action
                  </Button>
                }
              >
                Action button with color=&quot;inherit&quot;.
              </Callout>
            </Flex>
          </Example>
        ))}
      </Flex>
    ),
  },
  {
    id: "archetype-b",
    title: "Archetype B — stacked CTA (migration candidates)",
    description: (
      <>
        These call sites stack the action <em>below</em> the text (Box mt /
        column Flex). They were left out of the <code>action</code>-prop sweep
        because converting them moves the action up and to the right, pinned to
        the first text line. That is a visual redesign, not a
        behavior-preserving change. Each pair shows the current layout next to
        the proposed <code>action</code>-slot version. Mocked, static data.
      </>
    ),
    render: () => {
      const sampleSchemaError =
        "Permission denied while reading INFORMATION_SCHEMA.COLUMNS";
      const sampleQueryError =
        "Syntax error: Unexpected end of input near 'GROUP BY'";
      return (
        <Flex direction="column" gap="5">
          <Box>
            <div style={CANDIDATE_LABEL_STYLE}>EventForwarder.tsx</div>
            <Flex direction="column" gap="2">
              <Example label="Original: text + button below in Box mt">
                <Callout status="info">
                  Event Forwarder is not configured for this datasource.
                  <Box mt="3">
                    <Button>Set Up Event Forwarder</Button>
                  </Box>
                </Callout>
              </Example>
              <Example label="Proposed: action slot">
                <Callout
                  status="info"
                  action={<Button>Set Up Event Forwarder</Button>}
                >
                  Event Forwarder is not configured for this datasource.
                </Callout>
              </Example>
            </Flex>
          </Box>

          <Box>
            <div style={CANDIDATE_LABEL_STYLE}>ReviewAndPublish.tsx</div>
            <Flex direction="column" gap="2">
              <Example label="Original: text + button below in Box mt">
                <Callout status="info">
                  Select a revision from the dropdown above to review.
                  <Box mt="2">
                    <Button variant="soft">Back to Overview</Button>
                  </Box>
                </Callout>
              </Example>
              <Example label="Proposed: action slot">
                <Callout
                  status="info"
                  action={<Button variant="soft">Back to Overview</Button>}
                >
                  Select a revision from the dropdown above to review.
                </Callout>
              </Example>
            </Flex>
          </Box>

          <Box>
            <div style={CANDIDATE_LABEL_STYLE}>DatasourceConfigurator.tsx</div>
            <Flex direction="column" gap="2">
              <Example label="Original: error + reason + retry, column Flex">
                <Callout status="error" mt="2">
                  <Flex direction="column" gap="2">
                    <UIText weight="medium">
                      We&apos;re unable to identify tables for this Data Source.
                    </UIText>
                    <UIText>Reason: {sampleSchemaError}</UIText>
                    <Tooltip
                      body="You do not have permission to retry generating an information schema for this datasource."
                      shouldDisplay={false}
                    >
                      <Button variant="soft" color="red">
                        Retry
                      </Button>
                    </Tooltip>
                  </Flex>
                </Callout>
              </Example>
              <Example label="Proposed: action slot (Retry pins to the first line)">
                <Callout
                  status="error"
                  mt="2"
                  action={
                    <Tooltip
                      body="You do not have permission to retry generating an information schema for this datasource."
                      shouldDisplay={false}
                    >
                      <Button variant="soft" color="red">
                        Retry
                      </Button>
                    </Tooltip>
                  }
                >
                  <Flex direction="column" gap="2">
                    <UIText weight="medium">
                      We&apos;re unable to identify tables for this Data Source.
                    </UIText>
                    <UIText>Reason: {sampleSchemaError}</UIText>
                  </Flex>
                </Callout>
              </Example>
            </Flex>
          </Box>

          <Box>
            <div style={CANDIDATE_LABEL_STYLE}>
              FeatureEvaluationQueries.tsx
            </div>
            <Flex direction="column" gap="2">
              <Example label="Original: intro + bold error box + retry below">
                <Callout status="error" mb="3">
                  This query had an error with it the last time it ran:{" "}
                  <Box className="font-weight-bold" py="2">
                    {sampleQueryError}
                  </Box>
                  <Box mt="3">
                    <Button>Check it again.</Button>
                  </Box>
                </Callout>
              </Example>
              <Example label="Proposed: action slot (button pins to the first line, above the error box)">
                <Callout
                  status="error"
                  mb="3"
                  action={<Button color="inherit">Check it again.</Button>}
                >
                  This query had an error with it the last time it ran:{" "}
                  <Box className="font-weight-bold" py="2">
                    {sampleQueryError}
                  </Box>
                </Callout>
              </Example>
            </Flex>
          </Box>
        </Flex>
      );
    },
  },
  {
    id: "dismissible",
    title: "Dismissible",
    render: () => (
      <Flex direction="column" gap="3">
        <Example label='dismissible id="debug-callout-dismissible" with renderWhenDismissed'>
          <Callout
            status="info"
            dismissible
            id="debug-callout-dismissible"
            renderWhenDismissed={(undismiss) => (
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  undismiss();
                }}
              >
                Show again
              </Link>
            )}
          >
            This callout can be dismissed (persists in localStorage as
            callout:debug-callout-dismissible).
          </Callout>
        </Example>
        <Example label="Non-dismissible (contrast)">
          <Callout status="info">
            This callout is not dismissible. No dismiss button.
          </Callout>
        </Example>
      </Flex>
    ),
  },
  {
    id: "color-override",
    title: "Color Override",
    description: (
      <>
        Prefer <code>status</code> over <code>color</code>. The{" "}
        <code>color</code> prop is an escape hatch for cases where the standard
        status colors do not match the design intent.
      </>
    ),
    render: () => (
      <Flex direction="column" gap="3">
        <Example label='status="info" color="gray"'>
          <Callout status="info" color="gray">
            This callout uses color=&quot;gray&quot; as an override.
          </Callout>
        </Example>
        <Example label='status="info" color="purple"'>
          <Callout status="info" color="purple">
            This callout uses color=&quot;purple&quot; as an override.
          </Callout>
        </Example>
      </Flex>
    ),
  },
  {
    id: "premium-callout",
    title: "PremiumCallout",
    description: (
      <>
        These examples use a mocked UserContext provider with fixed plan states
        to exercise each upgrade tier without requiring auth.
      </>
    ),
    render: () => (
      <UserContext.Provider
        // @ts-expect-error - this is a mock
        value={{
          hasCommercialFeature: (feature: string) =>
            feature === "multi-armed-bandits",
          commercialFeatureLowestPlan: {
            "visual-editor": "pro",
            "custom-roles": "enterprise",
            "multi-armed-bandits": "pro",
          } as const,
          users: new Map(),
          organization: {},
          permissionsUtil: new Permissions({
            global: {
              permissions: {
                manageBilling: true,
              },
              limitAccessByEnvironment: false,
              environments: [],
            },
            projects: {},
          }),
        }}
      >
        <Flex direction="column" gap="3">
          <Example label='Pro upgrade state. commercialFeature="visual-editor" (gold, "Upgrade Now")'>
            <PremiumCallout commercialFeature="visual-editor" id="debug-pro">
              This Pro feature unlocks extra power and speed.
            </PremiumCallout>
          </Example>

          <Example label='Enterprise state. commercialFeature="custom-roles" (indigo, "Talk to Sales")'>
            <PremiumCallout
              commercialFeature="custom-roles"
              id="debug-enterprise"
            >
              This Enterprise feature gives you enhanced security and
              compliance.
            </PremiumCallout>
          </Example>

          <Example label='Has-feature + docs link. commercialFeature="multi-armed-bandits" (violet, "View docs")'>
            <PremiumCallout
              commercialFeature="multi-armed-bandits"
              id="debug-hasfeature"
              docSection="bandits"
            >
              You already have access to this premium feature.
            </PremiumCallout>
          </Example>

          <Example label="Dismissable has-feature. Same as above but dismissible">
            <PremiumCallout
              commercialFeature="multi-armed-bandits"
              id="debug-premium-dismissible"
              dismissible
              renderWhenDismissed={(undismiss) => (
                <Link
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    undismiss();
                  }}
                >
                  Show premium callout again
                </Link>
              )}
            >
              You already have access to this premium feature. This callout is
              dismissible.
              <DocLink docSection="bandits">View docs</DocLink>
            </PremiumCallout>
          </Example>
        </Flex>
      </UserContext.Provider>
    ),
  },
];

const TOP_NAV_HEIGHT = 56;
const PAGE_TOP_PADDING = 24;
const PAGE_BOTTOM_PADDING = 16;
const SIDEBAR_TOP_OFFSET = TOP_NAV_HEIGHT + PAGE_TOP_PADDING;
const SIDEBAR_MAX_HEIGHT = `calc(100vh - ${
  SIDEBAR_TOP_OFFSET + PAGE_BOTTOM_PADDING
}px)`;

export default function DebugCalloutsPage() {
  return (
    <div className="pt-4 pb-3">
      <Flex gap="6">
        <nav
          aria-label="Sections"
          style={{
            position: "sticky",
            top: SIDEBAR_TOP_OFFSET,
            alignSelf: "flex-start",
            minWidth: 220,
            maxHeight: SIDEBAR_MAX_HEIGHT,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <UIText as="div" weight="semibold" mb="2">
            Sections
          </UIText>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              overflowY: "auto",
              minHeight: 0,
              paddingRight: 8,
            }}
          >
            {sections.map(({ title, id }) => (
              <li key={id} style={{ marginBottom: 8 }}>
                <Link href={`#${id}`}>{title}</Link>
              </li>
            ))}
            <li style={{ margin: "12px 0 8px" }}>
              <UIText weight="semibold">All call sites</UIText>
            </li>
            {generatedNavItems.map(({ title, id }) => (
              <li key={id} style={{ marginBottom: 8 }}>
                <Link href={`#${id}`}>{title}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="container-fluid" style={{ flex: 1 }}>
          <h1 className="mb-2">Callout Debug Page</h1>
          <p style={{ color: "var(--gray-11)", marginBottom: 16 }}>
            Temporary visual-validation page. Delete after review. No auth, no
            network calls.
          </p>
          <div className="pagecontents">
            <Flex gap="4" direction="column">
              {sections.map(({ id, title, description, render }) => (
                <Frame key={id} id={id} style={{ scrollMarginTop: 90 }}>
                  <Flex direction="column" gap="3">
                    <h3 className="mb-1">{title}</h3>
                    {description ? <UIText>{description}</UIText> : null}
                    {render()}
                  </Flex>
                </Frame>
              ))}
            </Flex>

            <Box mt="6">
              <h2 className="mb-1">All call sites</h2>
              <p style={{ color: "var(--gray-11)", marginBottom: 16 }}>
                Every <code>&lt;Callout&gt;</code> and{" "}
                <code>&lt;PremiumCallout&gt;</code> in the front-end, generated
                from source by <code>.context/generate_debug_callouts.cjs</code>
                . Best-effort static render. Dynamic expressions show as amber{" "}
                <code>chips</code>, non-layout components are passed through as
                neutral stubs, custom icons and actions are placeholders, and
                conditional <code>status</code> is resolved to one branch.
                Expand <em>source</em> under any entry for the exact
                configuration.
              </p>
              <DebugAllCalloutsGenerated />
            </Box>
          </div>
        </div>
      </Flex>
    </div>
  );
}

DebugCalloutsPage.preAuth = true;
DebugCalloutsPage.preAuthTopNav = true;
