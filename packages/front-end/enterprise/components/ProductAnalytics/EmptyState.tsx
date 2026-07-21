import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import React, { useCallback, useRef, useState } from "react";
import { BsStars } from "react-icons/bs";
import {
  PiArrowRightBold,
  PiCaretDown,
  PiCaretRight,
  PiChartBar,
  PiDatabase,
  PiTable,
} from "react-icons/pi";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import Field from "@/components/Forms/Field";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import TextDivider from "@/components/TextDivider/TextDivider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import EnableAICallout from "@/components/EnableAICallout";
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

  const chatDisabled = !aiEnabled || !hasAISuggestions;

  const toolsExpanded = chatDisabled || showAdvancedOptions;

  return (
    <Box style={{ display: "flex", flex: 1, flexDirection: "column" }}>
      <Flex align="center">
        <Heading as="h1" size="x-large" weight="medium">
          Product Analytics
        </Heading>
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
        {!isDataSourceEmpty && !chatDisabled ? (
          <Box style={{ position: "absolute", top: 24, right: 24 }}>
            <LinkButton
              href="/product-analytics/explore/ai-chat"
              variant="ghost"
              size="sm"
              disabled={chatDisabled}
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
                Ask AI About Your Data
              </Heading>
            </Flex>
            <Text color="text-low" align="center" size="large" mt="1">
              {isDataSourceEmpty
                ? "Connect to a data source to start exploring your data."
                : "Ask a question in plain language and easily build charts and other visualizations"}
            </Text>
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
              <Box width="100%" style={{ maxWidth: 680 }}>
                <EnableAICallout source="product-analytics-empty-state" />
              </Box>
              <Box width="100%" style={{ maxWidth: 680, position: "relative" }}>
                <Field
                  textarea
                  minRows={chatDisabled ? 1 : 4}
                  maxRows={8}
                  placeholder="What's my revenue trend look like over the last year?..."
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
                  disabled={chatDisabled}
                />
                <Box
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    zIndex: 1,
                  }}
                >
                  <Button
                    onClick={handleSubmit}
                    disabled={chatDisabled || isDataSourceEmpty}
                    size="sm"
                  >
                    <PiArrowRightBold size={16} />
                  </Button>
                </Box>
              </Box>

              <Flex
                align="start"
                direction="column"
                width="100%"
                style={{
                  position: "relative",
                  maxWidth: 680,
                  marginInline: "auto",
                }}
              >
                <Box width="100%" style={{ maxWidth: 435, textAlign: "left" }}>
                  {chatDisabled ? (
                    <Text color="text-mid" size="medium">
                      Explore manually
                    </Text>
                  ) : (
                    <Link
                      onClick={() => setShowAdvancedOptions((open) => !open)}
                      underline="none"
                      aria-expanded={showAdvancedOptions}
                      aria-label={
                        showAdvancedOptions ? "Hide tools" : "Show tools"
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Text color="text-mid" size="medium">
                        Build visualizations manually
                      </Text>
                      {showAdvancedOptions ? (
                        <PiCaretDown size={14} aria-hidden />
                      ) : (
                        <PiCaretRight size={14} aria-hidden />
                      )}
                    </Link>
                  )}
                </Box>
                {toolsExpanded ? (
                  <Flex
                    direction="column"
                    gap="3"
                    align="start"
                    style={{
                      left: 0,
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 12px)",
                      zIndex: 1,
                    }}
                  >
                    <Text color="text-low" align="left">
                      Visualize metrics and explore your data.
                      {!chatDisabled && " Or, use Ask AI to get started."}
                    </Text>
                    <Flex
                      gap="3"
                      justify="start"
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
                        Fact Table explorer
                      </LinkButton>
                      <LinkButton
                        href="/product-analytics/explore/data-source"
                        variant="outline"
                        icon={<PiDatabase size={16} />}
                        disabled={!canRunFactQueries}
                      >
                        Data Source explorer
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
