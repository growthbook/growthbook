import { Box, Flex, Grid } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { BsStars } from "react-icons/bs";
import {
  PiArrowsClockwise,
  PiChatText,
  PiLayout,
  PiFileText,
  PiFunnel,
  PiPulse,
} from "react-icons/pi";
import { DashboardInterface } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useDashboards } from "@/hooks/useDashboards";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import PageHead from "@/components/Layout/PageHead";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import SegmentedControl from "@/ui/SegmentedControl";
import { Select, SelectItem } from "@/ui/Select";
import { dataSourceConnections } from "@/services/eventSchema";
import Text from "@/ui/Text";
import ChatComposer, {
  type ComposerSubmission,
} from "@/enterprise/components/AIChat/Composer/ChatComposer";
import { useMetricMentionItems } from "@/enterprise/components/AIChat/Composer/useMetricMentionItems";
import { LOCALSTORAGE_EXPLORER_DATASOURCE_KEY } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { storeDashboardBuilderHandoff } from "./dashboardBuilderHandoff";

const BLANK_DASHBOARD_HREF = "/product-analytics/dashboards/new?blank=1";

const STARTER_BOARD = {
  title: "Product health board",
  description:
    "Daily and weekly active users, daily signups, a signup funnel, signups by plan, weekly retention and top pages.",
  prompt:
    "Build a product health dashboard: daily and weekly active users, daily signups, the signup funnel, signups by plan, weekly retention and top pages.",
};

const SUGGESTIONS = [
  {
    icon: PiPulse,
    text: "Weekly product health: active users, signups and activation",
  },
  { icon: PiFunnel, text: "Signup funnel from first visit to first key event" },
  {
    icon: PiArrowsClockwise,
    text: "Weekly retention by signup cohort for the last 8 weeks",
  },
  { icon: PiFileText, text: "Top pages and where new users land first" },
];

const tile = {
  background: "var(--color-panel-solid)",
  border: "1px solid var(--slate-a4)",
  borderRadius: "var(--radius-1)",
};

function BoardThumbnail() {
  return (
    <Grid
      aria-hidden
      columns="2"
      gap="1"
      p="2"
      flexShrink="0"
      width="168px"
      style={{
        background: "var(--slate-a2)",
        border: "1px solid var(--slate-a4)",
        borderRadius: "var(--radius-2)",
      }}
    >
      <Box
        gridColumn="1 / -1"
        height="12px"
        style={{
          background: "var(--violet-a4)",
          borderRadius: "var(--radius-1)",
        }}
      />
      <Box gridColumn="1 / -1" height="32px" p="1" style={tile}>
        <svg
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
        >
          <path
            d="M0 15 L15 13 L30 14 L45 4 L55 11 L70 12 L85 10 L100 9"
            fill="none"
            stroke="var(--violet-9)"
            strokeWidth="1.5"
          />
        </svg>
      </Box>
      <Box height="24px" style={tile} />
      <Box height="24px" style={tile} />
    </Grid>
  );
}

export default function DashboardBuilderEmptyState() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { datasources, project } = useDefinitions();
  const { mutateDashboards } = useDashboards(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"build" | "ask">("build");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [storedDatasourceId, setDatasourceId] = useLocalStorage<string>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    "",
  );
  const datasourceId = datasources.some((d) => d.id === storedDatasourceId)
    ? storedDatasourceId
    : (datasources[0]?.id ?? "");
  const { items: mentionItems, ready: mentionItemsReady } =
    useMetricMentionItems(datasourceId);

  const startBuild = useCallback(
    async ({
      text,
      mentions,
    }: Pick<ComposerSubmission, "text" | "mentions">) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Describe what you want to track, or pick a suggestion.");
        return;
      }
      setError(null);
      setCreating(true);
      try {
        const res = await apiCall<{ dashboard: DashboardInterface }>(
          "/dashboards",
          {
            method: "POST",
            body: JSON.stringify({
              title: "Untitled Dashboard",
              editLevel: "private",
              shareLevel: "private",
              enableAutoUpdates: false,
              experimentId: "",
              projects: project ? [project] : [],
              blocks: [],
              isDraft: true,
            }),
          },
        );
        storeDashboardBuilderHandoff(res.dashboard.id, {
          text: trimmed,
          mentions,
          datasourceId,
          mode,
        });
        mutateDashboards();
        await router.push(`/product-analytics/dashboards/${res.dashboard.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setCreating(false);
      }
    },
    [apiCall, datasourceId, mode, mutateDashboards, project, router],
  );

  if (datasources.length === 0) {
    return (
      <Box className="container-fluid pagecontents">
        <PageHead
          breadcrumb={[
            {
              display: "Product Analytics",
              href: "/product-analytics/explore",
            },
            { display: "Dashboards", href: "/product-analytics/dashboards" },
            { display: "New Dashboard" },
          ]}
        />
        <Flex direction="column" align="center" gap="3" mt="9">
          <Heading as="h1" size="xl" weight="semibold">
            Describe a Dashboard
          </Heading>
          <Text color="text-low" align="center">
            Connect a Data Source so the AI Assistant has data to build from.
          </Text>
          <Flex gap="3">
            <LinkButton href="/datasources">Connect a Data Source</LinkButton>
            <LinkButton href={BLANK_DASHBOARD_HREF} variant="ghost">
              Start with a blank dashboard
            </LinkButton>
          </Flex>
        </Flex>
      </Box>
    );
  }

  return (
    <Box className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Product Analytics", href: "/product-analytics/explore" },
          { display: "Dashboards", href: "/product-analytics/dashboards" },
          { display: "New Dashboard" },
        ]}
      />
      <Flex
        direction="column"
        gap="5"
        mt="8"
        mx="auto"
        width="100%"
        style={{ maxWidth: 760 }}
      >
        <Flex direction="column" gap="1">
          <Heading as="h1" size="xl" weight="semibold">
            Describe a Dashboard
          </Heading>
          <Text color="text-low">
            The AI Assistant builds it while you watch. It stays a draft until
            you save it.
          </Text>
        </Flex>

        {error ? <Callout status="error">{error}</Callout> : null}

        <Flex direction="column" gap="3">
          <ChatComposer
            variant="hero"
            minRows={4}
            autoFocus
            placeholder="e.g. Weekly product health: signups, activation, retention and the pages people land on"
            value={input}
            onChange={setInput}
            onSend={startBuild}
            onCancel={() => undefined}
            loading={creating}
            isLocalStream={false}
            disabled={creating}
            mentionItems={mentionItems}
            mentionItemsReady={mentionItemsReady}
            sendLabel={mode === "build" ? "Generate dashboard" : "Ask"}
            heroToolbar={
              <>
                <SegmentedControl
                  aria-label="Mode"
                  size="sm"
                  value={mode}
                  setValue={setMode}
                  options={[
                    {
                      value: "build",
                      label: (
                        <Flex align="center" gap="1">
                          <PiLayout />
                          Build
                        </Flex>
                      ),
                    },
                    {
                      value: "ask",
                      label: (
                        <Flex align="center" gap="1">
                          <PiChatText />
                          Ask
                        </Flex>
                      ),
                    },
                  ]}
                />
                <Flex align="center" gap="2">
                  <Text color="text-mid" size="sm">
                    Data Source
                  </Text>
                  <Select
                    aria-label="Data Source"
                    size="sm"
                    value={datasourceId}
                    setValue={setDatasourceId}
                    disabled={creating}
                  >
                    {datasources.map((d) => {
                      const connection = dataSourceConnections.find(
                        (c) => c.type === d.type,
                      );
                      return (
                        <SelectItem key={d.id} value={d.id}>
                          <Flex align="center" gap="2">
                            {connection?.icon}
                            {connection ? `${connection.display} · ` : ""}
                            {d.name}
                          </Flex>
                        </SelectItem>
                      );
                    })}
                  </Select>
                </Flex>
              </>
            }
          />
          <Flex justify="end">
            <LinkButton href={BLANK_DASHBOARD_HREF} variant="ghost" size="sm">
              Start with a blank dashboard
            </LinkButton>
          </Flex>
        </Flex>

        <Flex direction="column" gap="2">
          <Text color="text-mid" size="sm" weight="medium">
            Start from a board
          </Text>
          <Flex
            align="center"
            gap="4"
            p="4"
            style={{
              border: "1px solid var(--slate-a5)",
              borderRadius: "var(--radius-3)",
              background: "var(--color-panel-solid)",
            }}
          >
            <BoardThumbnail />
            <Flex direction="column" gap="1" flexGrow="1">
              <Text weight="semibold">{STARTER_BOARD.title}</Text>
              <Text color="text-low" size="sm">
                {STARTER_BOARD.description}
              </Text>
            </Flex>
            <Button
              variant="outline"
              icon={<BsStars />}
              disabled={creating}
              onClick={() =>
                startBuild({ text: STARTER_BOARD.prompt, mentions: [] })
              }
              style={{ flexShrink: 0, fontSize: "var(--font-size-1)" }}
            >
              Build from this board
            </Button>
          </Flex>
        </Flex>

        <Flex direction="column" gap="2">
          <Text color="text-mid" size="sm" weight="medium">
            Suggestions
          </Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="2">
            {SUGGESTIONS.map(({ icon: Icon, text: suggestion }) => (
              <Button
                key={suggestion}
                variant="outline"
                color="gray"
                disabled={creating}
                onClick={() => setInput(suggestion)}
                style={{
                  justifyContent: "flex-start",
                  alignItems: "flex-start",
                  height: "auto",
                  fontWeight: 400,
                }}
              >
                <Flex align="start" gap="2" py="2">
                  <Flex
                    align="center"
                    flexShrink="0"
                    height="var(--line-height-2)"
                  >
                    <Icon size={16} />
                  </Flex>
                  <Box style={{ textAlign: "left", whiteSpace: "normal" }}>
                    {suggestion}
                  </Box>
                </Flex>
              </Button>
            ))}
          </Grid>
        </Flex>
      </Flex>
    </Box>
  );
}
