import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import React, { useCallback, useRef, useState } from "react";
import { BsStars } from "react-icons/bs";
import {
  PiArrowRightBold,
  PiChartBar,
  PiCode,
  PiDatabase,
  PiFunnel,
  PiTable,
} from "react-icons/pi";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import Field from "@/components/Forms/Field";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import TextDivider from "@/components/TextDivider/TextDivider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { PA_AI_CHAT_INITIAL_MESSAGE_KEY } from "./util";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";

export default function EmptyState() {
  const router = useRouter();
  const { permissionsUtil, hasCommercialFeature } = useUser();
  const { datasources, mutateDefinitions, project } = useDefinitions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const { aiEnabled } = useAISettings();

  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  const [newModalData, setNewModalData] =
    useState<null | Partial<DataSourceInterfaceWithParams>>(null);

  const isDataSourceEmpty = datasources.length === 0;

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sessionStorage.setItem(PA_AI_CHAT_INITIAL_MESSAGE_KEY, trimmed);
    router.push("/product-analytics/explore/ai-chat");
  }, [input, router]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const canRunMetricQueries =
    permissionsUtil.canRunMetricQueries({ projects: [project] }) ||
    permissionsUtil.canRunMetricQueries({ projects: [] });
  const canRunFactQueries =
    permissionsUtil.canRunFactQueries({ projects: [project] }) ||
    permissionsUtil.canRunFactQueries({ projects: [] });

  const chatDisabledReason = !aiEnabled
    ? "Enable AI for your organization to use AI Chat here and across GrowthBook."
    : !hasAISuggestions
      ? "Your current plan does not include AI Chat."
      : null;

  const toolsExpanded = !!chatDisabledReason || showAdvancedOptions;

  return (
    <Box style={{ display: "flex", flex: 1, flexDirection: "column" }}>
      <Flex align="center">
        <Heading as="h1" size="x-large" weight="medium">
          Product Analytics
        </Heading>
        <Badge color="indigo" label="Beta" ml="2" variant="solid" />
        <Flex align="center" gap="2" ml="3">
          <DataSourceDropdown />
        </Flex>
      </Flex>
      <Box
        mt="5"
        className="box"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          position: "relative",
          border: "1px solid var(--slate-a3)",
          borderRadius: "4px",
          padding: "40px 80px",
        }}
      >
        {!isDataSourceEmpty ? (
          <Box style={{ position: "absolute", top: 24, right: 24 }}>
            <LinkButton
              href="/product-analytics/explore/ai-chat"
              variant="ghost"
              size="sm"
              disabled={!!chatDisabledReason}
            >
              View chat history
            </LinkButton>
          </Box>
        ) : null}
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          width="100%"
          style={{ maxWidth: 760 }}
        >
          <Flex direction="column" align="center" pb="2">
            <Flex align="center" gap="2">
              <BsStars
                size={20}
                style={{ color: "var(--violet-a11)", flexShrink: 0 }}
              />
              <Heading as="h2" size="x-large" weight="medium">
                Ask AI about your data
              </Heading>
            </Flex>
            {isDataSourceEmpty && (
              <Text color="text-low" align="center" size="large">
                Connect to a data source to start exploring your data.
              </Text>
            )}
          </Flex>

          {isDataSourceEmpty ? (
            <Flex direction="column" gap="3" align="center">
              <Button
                variant="solid"
                color="violet"
                onClick={() => router.push("/datasources")}
                style={{
                  width: "fit-content",
                }}
              >
                Connect a Data Source
              </Button>
              <Flex justify="center" direction="column" gap="5" mt="3">
                <TextDivider width={435}>
                  or continue with an existing source
                </TextDivider>
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  width="100%"
                  mb="3"
                >
                  <DataSourceTypeSelector
                    value=""
                    setValue={(value) => {
                      const option = dataSourceConnections.find(
                        (o) => o.type === value,
                      );
                      if (!option) return;

                      setNewModalData({
                        type: option.type,
                        params: option.default,
                      } as Partial<DataSourceInterfaceWithParams>);

                      track("Data Source Type Selected", {
                        type: value,
                        newDatasourceForm: true,
                      });
                    }}
                  />
                </Flex>
              </Flex>
            </Flex>
          ) : (
            <>
              <Box width="100%" style={{ maxWidth: 680, position: "relative" }}>
                <Tooltip
                  enabled={!!chatDisabledReason}
                  content={chatDisabledReason ?? ""}
                >
                  <Field
                    textarea
                    minRows={4}
                    maxRows={8}
                    placeholder="Ask about your metrics, experiments, or more advanced questions like 'Build a conversion funnel for me'..."
                    containerStyle={{ width: "100%" }}
                    style={{
                      borderRadius: "var(--radius-5)",
                      padding: "16px 56px 40px 16px",
                      resize: "none",
                    }}
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={!!chatDisabledReason}
                  />
                </Tooltip>
                <Box
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    zIndex: 1,
                  }}
                >
                  <Tooltip
                    enabled={!!chatDisabledReason}
                    content={chatDisabledReason ?? ""}
                  >
                    <span
                      style={
                        chatDisabledReason
                          ? { cursor: "not-allowed" }
                          : undefined
                      }
                    >
                      <Button
                        onClick={handleSubmit}
                        disabled={!!chatDisabledReason || isDataSourceEmpty}
                        size="sm"
                        style={
                          chatDisabledReason
                            ? { pointerEvents: "none" }
                            : undefined
                        }
                      >
                        <PiArrowRightBold size={16} />
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              </Box>

              <Flex
                justify="center"
                direction="column"
                mt="4"
                width="100%"
                style={{ position: "relative" }}
              >
                <TextDivider width={435}>
                  {chatDisabledReason ? (
                    "Explore manually"
                  ) : (
                    <>
                      Want to explore manually?{" "}
                      <Link
                        onClick={() => setShowAdvancedOptions((open) => !open)}
                        aria-expanded={showAdvancedOptions}
                      >
                        {showAdvancedOptions ? "Hide tools" : "Show tools"}
                      </Link>
                    </>
                  )}
                </TextDivider>
                {toolsExpanded ? (
                  <Flex
                    direction="column"
                    gap="3"
                    align="center"
                    style={{
                      left: 0,
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 12px)",
                      zIndex: 1,
                    }}
                  >
                    <Text color="text-low" align="center">
                      Choose one of our exploration tools to manually explore
                      your data.
                      {!chatDisabledReason &&
                        " If you're unsure where to start, we suggest starting with the AI Analyst."}
                    </Text>
                    <Flex
                      gap="3"
                      justify="center"
                      wrap="wrap"
                      style={{ maxWidth: 720 }}
                    >
                      <LinkButton
                        href="/product-analytics/explore/metrics"
                        variant="outline"
                        icon={<PiChartBar size={16} />}
                        disabled={!canRunMetricQueries}
                      >
                        Metric explorer
                      </LinkButton>
                      <LinkButton
                        href="/product-analytics/explore/fact-table"
                        variant="outline"
                        icon={<PiTable size={16} />}
                        disabled={!canRunFactQueries}
                      >
                        Fact table explorer
                      </LinkButton>
                      <LinkButton
                        href="/product-analytics/explore/data-source"
                        variant="outline"
                        icon={<PiDatabase size={16} />}
                        disabled={!canRunFactQueries}
                      >
                        Data Source explorer
                      </LinkButton>
                      <LinkButton
                        href="/product-analytics/funnel-builder"
                        variant="outline"
                        icon={<PiFunnel size={16} />}
                        disabled={!canRunFactQueries}
                      >
                        Funnel explorer
                      </LinkButton>
                      <LinkButton
                        href="/sql-explorer"
                        variant="outline"
                        icon={<PiCode size={16} />}
                        disabled={!canRunFactQueries}
                      >
                        Custom SQL explorer
                      </LinkButton>
                    </Flex>
                  </Flex>
                ) : null}
              </Flex>
            </>
          )}
        </Flex>
      </Box>
      {newModalData && (
        <NewDataSourceForm
          initial={newModalData || undefined}
          source="datasource-list"
          onSuccess={async (id) => {
            await mutateDefinitions({});
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => {
            setNewModalData(null);
          }}
          showImportSampleData={false}
        />
      )}
    </Box>
  );
}
