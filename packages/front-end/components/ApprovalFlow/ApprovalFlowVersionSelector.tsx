import React from "react";
import { ApprovalFlow } from "shared/enterprise";
import { datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";

interface ApprovalFlowVersionSelectorProps {
  openApprovalFlows: ApprovalFlow[];
  allApprovalFlows?: ApprovalFlow[];
  selectedFlowId: string | null;
  onSelectFlow: (flow: ApprovalFlow | null) => void;
  showOpenFlowIndicator?: boolean;
}

export default function ApprovalFlowVersionSelector({
  openApprovalFlows,
  allApprovalFlows = openApprovalFlows,
  selectedFlowId,
  onSelectFlow,
  showOpenFlowIndicator = false,
}: ApprovalFlowVersionSelectorProps) {
  const { getUserDisplay } = useUser();

  const sortedAllFlows = [...allApprovalFlows].sort(
    (a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
  );

  const revisionNumberByFlowId = new Map<string, number>(
    sortedAllFlows.map((flow, i) => [flow.id, i + 1]),
  );

  const options = [
    { label: "Live", value: "live" },
    ...[...openApprovalFlows]
      .sort(
        (a, b) =>
          (revisionNumberByFlowId.get(b.id) ?? 0) -
          (revisionNumberByFlowId.get(a.id) ?? 0),
      )
      .map((flow) => ({
        label: `Revision ${revisionNumberByFlowId.get(flow.id) ?? 1}`,
        value: flow.id,
      })),
  ];

  const optionFlowMap = new Map<string, ApprovalFlow | null>([
    ["live", null],
    ...openApprovalFlows.map((flow) => [flow.id, flow] as const),
  ]);

  const selectedValue =
    selectedFlowId && optionFlowMap.has(selectedFlowId)
      ? selectedFlowId
      : "live";

  return (
    <div
      style={{
        position: "relative",
        width: 430,
        maxWidth: "min(430px, calc(100vw - 150px))",
      }}
    >
      {showOpenFlowIndicator && (
        <Tooltip content="Open approval flow">
          <span
            aria-label="Open approval flow"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transform: "translate(-40%, -40%)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--red-9)",
              display: "inline-block",
              flexShrink: 0,
              zIndex: 1,
            }}
          />
        </Tooltip>
      )}
      <SelectField
        value={selectedValue}
        options={options}
        sort={false}
        isSearchable={false}
        label=""
        style={{ width: "100%", maxWidth: "100%" }}
        onChange={(value) => {
          const selectedFlow = optionFlowMap.get(value) ?? null;
          onSelectFlow(selectedFlow);
        }}
        formatOptionLabel={({ value, label }) => {
          const flow = optionFlowMap.get(value) ?? null;
          return (
            <Flex align="center" justify="between" gap="3">
              <Text as="span" weight="semibold">
                {label}
              </Text>
              <Box flexGrow="1" />
              <Box
                flexShrink="1"
                overflow="hidden"
                style={{ textOverflow: "ellipsis" }}
              >
                {flow && (
                  <Text as="span" size="small" color="text-low">
                    by {getUserDisplay(flow.authorId)} on{" "}
                    {datetime(flow.dateUpdated)}
                  </Text>
                )}
              </Box>
              <Box flexShrink="0">
                <Badge
                  label={flow ? "Draft" : "Live"}
                  color={flow ? "indigo" : "teal"}
                  radius="full"
                />
              </Box>
            </Flex>
          );
        }}
      />
    </div>
  );
}
