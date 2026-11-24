import { useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { experimentHasLinkedChanges } from "shared/util";
import { useAuth } from "@/services/auth";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import {
  QA_OVERRIDES_SECTION_ID,
  QaOverrideOrder,
  applyQaOverrideOrder,
  groupQaOverrides,
  qaOverridesNeedGrouping,
  reconcileQaOverrideOrder,
  summarizeQaOverrideAudience,
} from "@/services/qaOverrides";
import {
  useRegisterExperimentEdit,
  useStagedState,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { InfoTip } from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { SCROLL_MARGIN_UNDER_TABS } from "@/components/Layout/constants";
import QaOverrideModal from "./QaOverrideModal";
import QaOverridesTable from "./QaOverridesTable";
import useQaOverrideNameLookups from "./useQaOverrideNameLookups";
import useQaOverridePermissions from "./useQaOverridePermissions";

const MATCH_TABLE_WIDTH = { contain: "inline-size" } as const;
const SCROLL_TARGET = { scrollMarginTop: SCROLL_MARGIN_UNDER_TABS } as const;

const ABOUT =
  "Serve this draft to yourself or your team in a non-production environment. " +
  "Testers get the first override they match and skip holdouts. " +
  "Overrides are removed automatically when the experiment starts.";

export default function QaOverridesSection({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
}) {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useExperimentQaOverrides(experiment);
  const { environmentOrder, eligibleEnvironments, canEditIn, canAdd } =
    useQaOverridePermissions(experiment);
  const lookups = useQaOverrideNameLookups(data?.sdkConnections);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; override: ExperimentQaOverrideWithStatus }
    | null
  >(null);
  // Dragging stages an order for the page's Save; adding, editing and
  // removing an override save on their own.
  const [stagedOrder, setStagedOrder, discardOrder] =
    useStagedState<QaOverrideOrder>("qaOverrideOrder", {});

  const stored = useMemo(() => data?.overrides ?? [], [data]);
  const order = useMemo(
    () => reconcileQaOverrideOrder(stagedOrder, stored),
    [stagedOrder, stored],
  );
  const overrides = useMemo(
    () => applyQaOverrideOrder(stored, order),
    [stored, order],
  );
  const variations = getLatestPhaseVariations(experiment);
  const groups = useMemo(
    () => groupQaOverrides(overrides, environmentOrder),
    [overrides, environmentOrder],
  );
  const grouped = qaOverridesNeedGrouping(groups);

  const remove = async (override: ExperimentQaOverrideWithStatus) => {
    await apiCall(`/qa-overrides/${override.id}`, { method: "DELETE" });
    await mutate();
  };

  const reorder = (environment: string, orderedIds: string[]) =>
    setStagedOrder(
      reconcileQaOverrideOrder({ ...order, [environment]: orderedIds }, stored),
    );

  const reviewOrder = (from: ExperimentQaOverrideWithStatus[]) =>
    Object.fromEntries(
      groupQaOverrides(from, environmentOrder)
        .filter((group) => group.environment in order)
        .map((group) => [
          group.environment,
          group.rows.map(({ item }) => overrideLabel(item)),
        ]),
    );
  const overrideLabel = ({
    assignment,
    filters,
  }: ExperimentQaOverrideWithStatus) => {
    const serves =
      assignment.type === "random"
        ? "Set by experiment"
        : (variations.find((v) => v.id === assignment.variationId)?.name ??
          "Deleted variation");
    const audience = summarizeQaOverrideAudience(filters, lookups)
      .map((segment) => segment.text)
      .join(", ");
    return audience ? `${serves}: ${audience}` : serves;
  };

  useRegisterExperimentEdit("qaOverrideOrder", Object.keys(order).length > 0, {
    label: "QA override order",
    review: () => ({
      before: reviewOrder(stored),
      after: reviewOrder(overrides),
    }),
    discard: discardOrder,
    // Shown in the saved order while the refetch is on its way.
    onSaved: () => {
      void mutate(data && { ...data, overrides }, { revalidate: true });
      discardOrder();
    },
    changes: () => ({
      qaOverrideOrder: Object.entries(order).map(
        ([environment, overrideIds]) => ({ environment, overrideIds }),
      ),
    }),
  });

  const isEmpty = overrides.length === 0 && !error;
  const allProduction = eligibleEnvironments.length === 0;
  const addButton = (
    <Button
      variant="outline"
      size="sm"
      icon={<PiPlusBold />}
      onClick={() => setModal({ mode: "create" })}
    >
      Add override
    </Button>
  );

  return (
    <>
      <Separator size="4" my="5" />
      <Frame
        id={QA_OVERRIDES_SECTION_ID}
        px={isEmpty ? "6" : "0"}
        py={isEmpty ? "5" : "0"}
        mb="0"
        style={{
          ...MATCH_TABLE_WIDTH,
          ...SCROLL_TARGET,
          overflow: isEmpty ? undefined : "hidden",
        }}
      >
        {isEmpty ? (
          <Flex direction="column" align="center" gap="2">
            <Heading as="h4" size="xs" mb="0">
              QA Overrides
            </Heading>
            <Text color="text-mid" align="center">
              {allProduction
                ? "QA overrides only run in non-production environments, and every environment in this organization is marked as production."
                : "Serve this draft to yourself or your team in a non-production environment before it starts."}
            </Text>
            {allProduction ? (
              <Link href="/environments" mt="2">
                Manage environments →
              </Link>
            ) : canAdd ? (
              <Box mt="2">{addButton}</Box>
            ) : null}
          </Flex>
        ) : (
          <>
            <Flex align="center" gap="2" px="4" py="3">
              <Heading as="h4" size="xs" mb="0">
                QA Overrides
              </Heading>
              <InfoTip content={ABOUT} />
              <Box flexGrow="1" />
              {canAdd && addButton}
            </Flex>
            {error && (
              <Box px="4" pb="3">
                <Callout status="error">
                  Could not load QA overrides: {error.message}
                </Callout>
              </Box>
            )}
            {!experimentHasLinkedChanges(experiment) && (
              <Box px="4" pb="3">
                <Callout status="info" size="sm">
                  These overrides have nothing to serve yet. Add a Feature Flag,
                  Visual Editor change or URL Redirect to this experiment.
                </Callout>
              </Box>
            )}
            {overrides.length > 0 && (
              <QaOverridesTable
                groups={groups}
                variations={variations}
                grouped={grouped}
                reorderable={grouped}
                lookups={lookups}
                canEdit={(override) => canEditIn(override.environment)}
                onEdit={(override) => setModal({ mode: "edit", override })}
                onRemove={remove}
                removeConfirmation={(override) =>
                  `This draft will stop being served to ${override.environment} through this override.`
                }
                onReorder={reorder}
              />
            )}
          </>
        )}
      </Frame>
      {modal && (
        <QaOverrideModal
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          existing={modal.mode === "edit" ? modal.override : undefined}
          sdkConnections={data?.sdkConnections}
          close={() => setModal(null)}
          onSaved={async () => {
            await mutate();
            setModal(null);
          }}
        />
      )}
    </>
  );
}
