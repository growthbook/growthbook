import React, { useMemo } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiCheckCircleFill, PiXCircleFill } from "react-icons/pi";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import {
  StoryMeta,
  StoryModule,
  StoryStatus,
  slugify,
  storyCategories,
} from "@/ui/storyMeta";

// Every *.stories.tsx under ui/ is picked up automatically. Its `meta` export
// places it on this page; test/designSystemStories.test.ts fails CI when a file
// has no valid meta.
const storyModules = import.meta.glob<StoryModule>("/ui/**/*.stories.tsx", {
  eager: true,
});

type Entry = {
  id: string;
  meta: StoryMeta;
  Stories: () => React.ReactElement | null;
};

const STATUS_ORDER: Record<StoryStatus, number> = {
  stable: 0,
  beta: 1,
  legacy: 2,
  deprecated: 3,
};

const STATUS_BADGE: Record<
  Exclude<StoryStatus, "stable">,
  React.ComponentProps<typeof Badge>["color"]
> = {
  beta: "violet",
  legacy: "amber",
  deprecated: "red",
};

// Runs at render, not module scope: during Turbopack SSR the globbed modules
// are still empty objects while this module evaluates.
function buildSections() {
  const entries: Entry[] = Object.values(storyModules)
    .map(({ meta, default: Stories }) => ({
      id: slugify(meta.name),
      meta,
      Stories,
    }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.meta.status] - STATUS_ORDER[b.meta.status] ||
        a.meta.name.localeCompare(b.meta.name),
    );

  return storyCategories
    .map((category) => ({
      ...category,
      entries: entries.filter((e) => e.meta.category === category.id),
    }))
    .filter((s) => s.entries.length > 0);
}

const TOP_NAV_HEIGHT = 56;
const PAGE_TOP_PADDING = 24;
const PAGE_BOTTOM_PADDING = 16;
const SIDEBAR_TOP_OFFSET = TOP_NAV_HEIGHT + PAGE_TOP_PADDING;
const SIDEBAR_MAX_HEIGHT = `calc(100vh - ${
  SIDEBAR_TOP_OFFSET + PAGE_BOTTOM_PADDING
}px)`;

export default function DesignSystemPage() {
  const sections = useMemo(buildSections, []);
  return (
    <Box pt="5" pb="4">
      <Flex gap="6">
        <nav
          aria-label="Components"
          style={{
            position: "sticky",
            top: SIDEBAR_TOP_OFFSET,
            alignSelf: "flex-start",
            minWidth: 220,
            maxHeight: SIDEBAR_MAX_HEIGHT,
            overflowY: "auto",
            paddingRight: 8,
          }}
        >
          {sections.map((section) => (
            <Box key={section.id} mb="4">
              <Text as="div" weight="semibold" mb="2">
                <Link href={`#${section.id}`}>{section.label}</Link>
              </Text>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {section.entries.map(({ id, meta }) => (
                  <li key={id} style={{ marginBottom: 6 }}>
                    <Link href={`#${id}`}>
                      <Text color={isRetired(meta) ? "text-low" : undefined}>
                        {meta.name}
                      </Text>
                    </Link>
                  </li>
                ))}
              </ul>
            </Box>
          ))}
        </nav>

        <div style={{ flex: 1, minWidth: 0, maxWidth: 1080 }}>
          <Heading as="h1" size="2xl" mb="4">
            GrowthBook Design System
          </Heading>
          <Flex gap="6" direction="column">
            {sections.map((section) => (
              <Flex
                key={section.id}
                id={section.id}
                direction="column"
                gap="7"
                style={{ scrollMarginTop: 80 }}
              >
                <Heading as="h2" size="xl">
                  {section.label}
                </Heading>
                {section.entries.map((entry) => (
                  <StoryFrame key={entry.id} {...entry} />
                ))}
              </Flex>
            ))}
          </Flex>
        </div>
      </Flex>
    </Box>
  );
}

function StoryFrame({ id, meta, Stories }: Entry) {
  return (
    <Box
      id={id}
      pb="7"
      style={{
        scrollMarginTop: 80,
        borderBottom: "1px solid var(--gray-a4)",
      }}
    >
      <Flex direction="column" gap="2" mb="4" style={{ maxWidth: 760 }}>
        <Flex align="center" gap="2">
          <Heading as="h3" size="lg" mb="0">
            {meta.name}
          </Heading>
          {meta.status !== "stable" && (
            <Badge
              label={meta.status}
              color={STATUS_BADGE[meta.status]}
              variant="soft"
            />
          )}
        </Flex>
        <Text color="text-mid">{inline(meta.summary)}</Text>
        {"replacedBy" in meta && (
          <Text weight="medium">
            Use{" "}
            <Link href={`#${slugify(meta.replacedBy)}`}>{meta.replacedBy}</Link>{" "}
            in new code.
          </Text>
        )}
      </Flex>

      <Frame>
        <Stories />
      </Frame>

      <Guidance meta={meta} />
    </Box>
  );
}

function Guidance({ meta }: { meta: StoryMeta }) {
  const hasRules = meta.useWhen.length > 0 || meta.avoidWhen.length > 0;
  return (
    <Flex direction="column" gap="3">
      {hasRules && (
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <RuleCard
            tone="do"
            title="Use when"
            items={meta.useWhen.map((u) => ({ key: u, body: inline(u) }))}
          />
          <RuleCard
            tone="dont"
            title="Don't use when"
            items={meta.avoidWhen.map((a) => ({
              key: a.reason,
              body: (
                <>
                  {inline(a.reason)}
                  {a.use && (
                    <>
                      {" "}
                      Use <Link href={`#${slugify(a.use)}`}>{a.use}</Link>.
                    </>
                  )}
                </>
              ),
            }))}
          />
        </Grid>
      )}
      {meta.examples && meta.examples.length > 0 && (
        <Text size="sm" color="text-mid">
          In the codebase:{" "}
          {meta.examples.map((e, i) => (
            <React.Fragment key={e}>
              {i > 0 && " · "}
              <code style={CODE_STYLE} title={e}>
                {e.split("/").pop()}
              </code>
            </React.Fragment>
          ))}
        </Text>
      )}
      {meta.related && meta.related.length > 0 && (
        <Text size="sm" color="text-mid">
          Related:{" "}
          {meta.related.map((r, i) => (
            <React.Fragment key={r}>
              {i > 0 && " · "}
              <Link href={`#${slugify(r)}`}>{r}</Link>
            </React.Fragment>
          ))}
        </Text>
      )}
    </Flex>
  );
}

function RuleCard({
  tone,
  title,
  items,
}: {
  tone: "do" | "dont";
  title: string;
  items: { key: string; body: React.ReactNode }[];
}) {
  if (!items.length) return <Box />;
  const accent = tone === "do" ? "var(--green-9)" : "var(--red-9)";
  const Icon = tone === "do" ? PiCheckCircleFill : PiXCircleFill;
  return (
    <Box
      p="4"
      style={{
        borderTop: `3px solid ${accent}`,
        borderRadius: "var(--radius-3)",
        background: "var(--gray-a2)",
      }}
    >
      <Text as="div" weight="semibold" mb="2">
        {title}
      </Text>
      <Flex direction="column" gap="2">
        {items.map(({ key, body }) => (
          <Flex key={key} gap="2" align="start">
            <Icon
              aria-hidden
              style={{ color: accent, flexShrink: 0, marginTop: 3 }}
            />
            <Text>{body}</Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}

const CODE_STYLE: React.CSSProperties = {
  fontFamily: "var(--code-font-family)",
  fontSize: "0.9em",
  padding: "1px 5px",
  borderRadius: "var(--radius-2)",
  background: "var(--gray-a3)",
  color: "var(--color-text-high)",
};

/** Renders `backticked` spans in guidance copy as inline code. */
function inline(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} style={CODE_STYLE}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function isRetired(meta: StoryMeta) {
  return meta.status === "legacy" || meta.status === "deprecated";
}

DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;
