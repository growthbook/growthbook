import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import React, { useCallback, useRef, useState } from "react";
import { BsStars } from "react-icons/bs";
import {
  PiArrowRightBold,
  PiChartBar,
  PiCode,
  PiDatabase,
  PiTable,
} from "react-icons/pi";
import Field from "@/components/Forms/Field";
import TextDivider from "@/components/TextDivider/TextDivider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import { PA_AI_CHAT_INITIAL_MESSAGE_KEY } from "./util";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";

export default function EmptyState() {
  const router = useRouter();
  const { permissionsUtil, hasCommercialFeature } = useUser();
  const { datasources } = useDefinitions();
  const { project } = useDefinitions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

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

  const hasDatasources = datasources.length > 0;
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  return (
    <Box m="7">
      <Flex align="center">
        <Heading as="h1" size="2x-large" weight="medium">
          Product Analytics
        </Heading>
        <Badge color="indigo" label="Beta" ml="2" variant="solid" />
      </Flex>
      <Box mt="5">
        <Flex align="center" gap="2">
          <Text color="text-low">Data source:</Text>
          <DataSourceDropdown />
        </Flex>
      </Box>
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
        }}
      >
        <Flex direction="column" align="center" pb="6">
          <Heading as="h2" size="x-large" weight="medium">
            Select an Explorer Type
          </Heading>
          <Text color="text-low" align="center" size="large">
            Choose how you want to explore your data
          </Text>
        </Flex>

        <Flex direction="column" gap="3">
          {!hasDatasources && (
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
                    !input.trim() || !hasDatasources || !hasAISuggestions
                  }
                  size="md"
                >
                  <PiArrowRightBold size={16} />
                </Button>
              </Flex>
            </Flex>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}
