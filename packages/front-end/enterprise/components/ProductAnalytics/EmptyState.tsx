import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { BsStars } from "react-icons/bs";
import {
  PiArrowRightBold,
  PiChartBar,
  PiCode,
  PiDatabase,
  PiTable,
} from "react-icons/pi";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TextDivider from "@/components/TextDivider/TextDivider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { getAvailableAIModelOptions } from "@/services/aiModelSelectOptions";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  PA_AI_CHAT_INITIAL_MESSAGE_KEY,
  PA_AI_CHAT_INITIAL_MODEL_KEY,
} from "./util";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";

export default function EmptyState() {
  const router = useRouter();
  const { permissionsUtil, hasCommercialFeature } = useUser();
  const { datasources } = useDefinitions();
  const { project } = useDefinitions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const { defaultAIModel } = useAISettings();
  const permissions = usePermissionsUtil();
  const canPickModel = permissions.canManageOrgSettings();
  const [chatModel, setChatModel] = useState(defaultAIModel);

  const paChatModelSelectOptions = useMemo(
    () => getAvailableAIModelOptions(),
    [],
  );
  const isDataSourceEmpty = datasources.length === 0;

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sessionStorage.setItem(PA_AI_CHAT_INITIAL_MESSAGE_KEY, trimmed);
    sessionStorage.setItem(PA_AI_CHAT_INITIAL_MODEL_KEY, chatModel);
    router.push("/product-analytics/explore/ai-chat");
  }, [input, chatModel, router]);

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

  return (
    <Box m="7">
      <Flex align="center">
        <Heading as="h1" size="2x-large" weight="medium">
          Product Analytics
        </Heading>
        <Badge color="indigo" label="Beta" ml="2" variant="solid" />
        <Flex align="center" gap="2" ml="3">
          <DataSourceDropdown />
        </Flex>
      </Flex>
      <Box
        mt="5"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          minHeight: "400px",
          border: "1px solid var(--slate-a3)",
          borderRadius: "4px",
          backgroundColor: "var(--surface-background-color)",
          padding: "60px 80px",
        }}
      >
        <Flex direction="column" align="center" pb="6">
          <Heading as="h2" size="x-large" weight="medium">
            {isDataSourceEmpty
              ? "No data sources selected"
              : "Select an Explorer Type"}
          </Heading>
          <Text color="text-low" align="center" size="large">
            {isDataSourceEmpty
              ? "Connect to a data source to start exploring your data."
              : "Choose how you want to explore your data"}
          </Text>
        </Flex>

        <Flex direction="column" gap="3">
          {isDataSourceEmpty ? (
            <Callout status="warning">
              Before you can explore your data, you&apos;ll need to{" "}
              <Link href="/datasources">connect a Data Source.</Link>
            </Callout>
          )}
          <Flex gap="3">
            <LinkButton
              href="/product-analytics/explore/metrics"
              variant="outline"
              disabled={
                // If the user can't run metrics for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunMetricQueries({
                  projects: [project],
                }) &&
                  !permissionsUtil.canRunMetricQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiChartBar size={24} />
                <Text weight="medium">Metrics</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/product-analytics/explore/fact-table"
              variant="outline"
              disabled={
                // If the user can't run fact queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({ projects: [project] }) &&
                  !permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiTable size={24} />
                <Text weight="medium">Fact Table</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/product-analytics/explore/data-source"
              variant="outline"
              disabled={
                // If the user can't run fact queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({ projects: [project] }) &&
                  !!permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiDatabase size={24} />
                <Text weight="medium">Data Source</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/sql-explorer"
              variant="outline"
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
              disabled={
                // If the user can't run custom SQL queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({
                  projects: [project],
                }) &&
                  !permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
            >
              <Flex direction="column" align="center" gap="1">
                <PiCode size={24} />
                <Text weight="medium">Custom SQL</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/product-analytics/explore/ai-chat"
              variant="outline"
              disabled={!hasDatasources || !hasAISuggestions}
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <BsStars size={22} />
                <Text weight="medium">AI Chat</Text>
              </Flex>
            </LinkButton>
          </Flex>
          <Flex justify="center" direction="column" gap="5" mt="3">
            <TextDivider width={435}>or ask anything with AI</TextDivider>
            <Flex align="center" gap="3" direction="column" justify="center">
              <Flex gap="2" width="100%" align="center" justify="center">
                {!isCloud() && (
                  <Tooltip
                    enabled={!canPickModel}
                    content="Only users with permission to manage organization settings can change the model here. Organization admins can set defaults in General Settings → AI Settings."
                  >
                    <span
                      style={
                        !canPickModel ? { cursor: "not-allowed" } : undefined
                      }
                    >
                      <SelectField
                        id="empty-state-ai-chat-model"
                        value={chatModel}
                        onChange={(v) => {
                          if (canPickModel) setChatModel(v);
                        }}
                        options={paChatModelSelectOptions}
                        disabled={!canPickModel}
                        placeholder="AI model"
                        formatOptionLabel={(option, { context }) => {
                          if (
                            option.value === defaultAIModel &&
                            context === "menu"
                          ) {
                            return (
                              <Flex direction="column" gap="0">
                                <Text>{option.label}</Text>
                                <span
                                  style={{
                                    color: "var(--text-color-muted)",
                                    fontSize: "var(--font-size-1)",
                                  }}
                                >
                                  Organization Default
                                </span>
                              </Flex>
                            );
                          }
                          return <span>{option.label}</span>;
                        }}
                        containerStyle={{
                          marginBottom: 0,
                          ...(!canPickModel
                            ? { pointerEvents: "none" }
                            : undefined),
                        }}
                        containerStyles={{
                          control: (styles) => ({
                            ...styles,
                            width: "150px",
                            minHeight: "35px",
                            height: "35px",
                          }),
                          valueContainer: (styles) => ({
                            ...styles,
                            paddingTop: 0,
                            paddingBottom: 0,
                          }),
                          indicatorsContainer: (styles) => ({
                            ...styles,
                            height: "35px",
                          }),
                          menu: (styles) => ({
                            ...styles,
                            width: "max-content",
                            minWidth: "100%",
                          }),
                        }}
                      />
                    </span>
                  </Tooltip>
                )}
                <Field
                  placeholder="Ask about metrics, experiments, or setup..."
                  containerStyle={{
                    maxWidth: "800px",
                    flex: 1,
                  }}
                  style={{ height: "40px" }}
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!hasDatasources || !hasAISuggestions}
                />
                <Button
                  onClick={handleSubmit}
                  disabled={
                    // If the user can't run metrics for the current project, or globally, don't show enable the button
                    !permissionsUtil.canRunMetricQueries({
                      projects: [project],
                    }) && !permissionsUtil.canRunMetricQueries({ projects: [] })
                  }
                  style={{
                    height: "116px",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    width: "160px",
                  }}
                >
                  <Flex direction="column" align="center" gap="1">
                    <PiChartBar size={24} />
                    <Text weight="medium">Metrics</Text>
                  </Flex>
                </LinkButton>
                <LinkButton
                  href="/product-analytics/explore/fact-table"
                  variant="outline"
                  disabled={
                    // If the user can't run fact queries for the current project, or globally, don't show enable the button
                    !permissionsUtil.canRunFactQueries({
                      projects: [project],
                    }) && !permissionsUtil.canRunFactQueries({ projects: [] })
                  }
                  style={{
                    height: "116px",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    width: "160px",
                  }}
                >
                  <Flex direction="column" align="center" gap="1">
                    <PiTable size={24} />
                    <Text weight="medium">Fact Table</Text>
                  </Flex>
                </LinkButton>
                <LinkButton
                  href="/product-analytics/explore/data-source"
                  variant="outline"
                  disabled={
                    // If the user can't run fact queries for the current project, or globally, don't show enable the button
                    !permissionsUtil.canRunFactQueries({
                      projects: [project],
                    }) && !!permissionsUtil.canRunFactQueries({ projects: [] })
                  }
                  style={{
                    height: "116px",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    width: "160px",
                  }}
                >
                  <Flex direction="column" align="center" gap="1">
                    <PiDatabase size={24} />
                    <Text weight="medium">Data Source</Text>
                  </Flex>
                </LinkButton>
                <LinkButton
                  href="/sql-explorer"
                  variant="outline"
                  style={{
                    height: "116px",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    width: "160px",
                  }}
                  disabled={
                    // If the user can't run custom SQL queries for the current project, or globally, don't show enable the button
                    !permissionsUtil.canRunFactQueries({
                      projects: [project],
                    }) && !permissionsUtil.canRunFactQueries({ projects: [] })
                  }
                >
                  <Flex direction="column" align="center" gap="1">
                    <PiCode size={24} />
                    <Text weight="medium">Custom SQL</Text>
                  </Flex>
                </LinkButton>
                <LinkButton
                  href="/product-analytics/explore/ai-chat"
                  variant="outline"
                  disabled={!hasAISuggestions}
                  style={{
                    height: "116px",
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    width: "160px",
                  }}
                >
                  <Flex direction="column" align="center" gap="1">
                    <BsStars size={22} />
                    <Text weight="medium">AI Chat</Text>
                  </Flex>
                </LinkButton>
              </Flex>
              <Flex justify="center" direction="column" gap="5" mt="3">
                <TextDivider width={435}>or ask anything with AI</TextDivider>
                <Flex
                  align="center"
                  gap="3"
                  direction="column"
                  justify="center"
                >
                  <Flex gap="2" width="100%" align="center" justify="center">
                    <Field
                      placeholder="Ask about metrics, experiments, or setup..."
                      containerStyle={{
                        maxWidth: "800px",
                        flex: 1,
                      }}
                      style={{ height: "40px" }}
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={isDataSourceEmpty || !hasAISuggestions}
                    />
                    <Button
                      onClick={handleSubmit}
                      disabled={
                        !input.trim() || isDataSourceEmpty || !hasAISuggestions
                      }
                      size="md"
                    >
                      <PiArrowRightBold size={16} />
                    </Button>
                  </Flex>
                </Flex>
              </Flex>
            </>
          )}
        </Flex>
      </Box>
    </Box>
  );
}
