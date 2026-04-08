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
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import TextDivider from "@/components/TextDivider/TextDivider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import { getAvailableAIModelOptions } from "@/services/aiModelSelectOptions";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import {
  PA_AI_CHAT_INITIAL_MESSAGE_KEY,
  PA_AI_CHAT_INITIAL_MODEL_KEY,
} from "./util";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";

export default function EmptyState() {
  const router = useRouter();
  const { permissionsUtil, hasCommercialFeature } = useUser();
  const { datasources, mutateDefinitions, project } = useDefinitions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const { defaultAIModel, aiEnabled } = useAISettings();
  const permissions = usePermissionsUtil();
  const canPickModel = permissions.canManageOrgSettings();
  const [chatModel, setChatModel] = useState(defaultAIModel);

  const paChatModelSelectOptions = useMemo(
    () => getAvailableAIModelOptions(),
    [],
  );
  const [newModalData, setNewModalData] =
    useState<null | Partial<DataSourceInterfaceWithParams>>(null);

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

  const modelDisabledReason = !aiEnabled
    ? "Enable AI for your organization to use AI Chat here and across GrowthBook."
    : !canPickModel
      ? "Only users with permission to manage organization settings can change the model here. Organization admins can set defaults in General Settings → AI Settings."
      : null;

  const chatDisabledReason = !aiEnabled
    ? "Enable AI for your organization to use AI Chat here and across GrowthBook."
    : !hasAISuggestions
      ? "Your current plan does not include AI Chat."
      : null;

  const buttonStyle = {
    height: "116px",
    paddingTop: "16px",
    paddingBottom: "16px",
    width: "160px",
  };

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
        <Flex
          direction="column"
          align="center"
          pb={isDataSourceEmpty ? "2" : "6"}
        >
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
                <div className="mb-3 d-flex flex-column align-items-center justify-content-center w-100">
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
                </div>
              </Flex>
            </Flex>
          ) : (
            <>
              <Flex gap="3">
                <LinkButton
                  href="/product-analytics/explore/metrics"
                  variant="outline"
                  disabled={
                    // If the user can't run metrics for the current project, or globally, don't show enable the button
                    !permissionsUtil.canRunMetricQueries({
                      projects: [project],
                    }) && !permissionsUtil.canRunMetricQueries({ projects: [] })
                  }
                  style={buttonStyle}
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
                  style={buttonStyle}
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
                    }) && !permissionsUtil.canRunFactQueries({ projects: [] })
                  }
                  style={buttonStyle}
                >
                  <Flex direction="column" align="center" gap="1">
                    <PiDatabase size={24} />
                    <Text weight="medium">Data Source</Text>
                  </Flex>
                </LinkButton>
                <LinkButton
                  href="/sql-explorer"
                  variant="outline"
                  style={buttonStyle}
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
                  style={buttonStyle}
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
                    {!isCloud() && (
                      <Tooltip
                        enabled={!!modelDisabledReason}
                        content={modelDisabledReason ?? ""}
                      >
                        <span
                          style={
                            modelDisabledReason
                              ? { cursor: "not-allowed" }
                              : undefined
                          }
                        >
                          <SelectField
                            id="empty-state-ai-chat-model"
                            value={chatModel}
                            onChange={(v) => {
                              if (!modelDisabledReason) setChatModel(v);
                            }}
                            options={paChatModelSelectOptions}
                            disabled={!!modelDisabledReason}
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
                              ...(modelDisabledReason
                                ? { pointerEvents: "none" }
                                : undefined),
                            }}
                            containerStyles={{
                              control: (styles) => ({
                                ...styles,
                                width: "150px",
                                minHeight: "35px",
                                height: "40px",
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
                    <Tooltip
                      enabled={!!chatDisabledReason}
                      content={chatDisabledReason ?? ""}
                    >
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
                        disabled={!!chatDisabledReason}
                      />
                    </Tooltip>
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
                          disabled={
                            !!chatDisabledReason ||
                            !input.trim() ||
                            isDataSourceEmpty
                          }
                          size="md"
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
                  </Flex>
                </Flex>
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
