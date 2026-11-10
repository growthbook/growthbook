import { useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { useAuth } from "@/services/auth";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import {
  groupQaOverrides,
  qaOverridesNeedGrouping,
} from "@/services/qaOverrides";
import { InfoTip } from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import QaOverrideModal from "./QaOverrideModal";
import QaOverridesTable, { QaOverrideRow } from "./QaOverridesTable";
import { useQaOverrideNameLookups } from "./QaOverrideFilterChips";
import useQaOverridePermissions from "./useQaOverridePermissions";

// Matches the variations table above it in the Implementation panel.
const EMPTY_CARD_WIDTH = 694;

const ABOUT =
  "Serve this draft to yourself or your team in a non-production environment. " +
  "Testers skip holdout, targeting and traffic. When several overrides match, " +
  "the first one wins. Overrides are removed automatically when the experiment starts.";

/**
 * The QA Overrides card at the bottom of a draft's Implementation panel.
 * Rendered through `TrafficAllocationFunnel`'s `qaOverrides` slot.
 */
export default function QaOverridesSection({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
}) {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useExperimentQaOverrides(experiment.id);
  const { environmentOrder, eligibleEnvironments, canEditIn, canAdd } =
    useQaOverridePermissions(experiment);
  const lookups = useQaOverrideNameLookups(data?.sdkConnections);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; override: ExperimentQaOverrideWithStatus }
    | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const overrides = useMemo(() => data?.overrides ?? [], [data]);
  const variations = getLatestPhaseVariations(experiment);
  const groups = useMemo(
    () =>
      groupQaOverrides(overrides, environmentOrder).map((g) => ({
        environment: g.environment,
        rows: g.rows.map((r) => ({
          priority: r.priority,
          item: { override: r.item, variations } as QaOverrideRow,
        })),
      })),
    [overrides, variations, environmentOrder],
  );
  const grouped = qaOverridesNeedGrouping(groups);

  const remove = async (row: QaOverrideRow) => {
    setActionError(null);
    await apiCall(`/qa-overrides/${row.override.id}`, { method: "DELETE" });
    await mutate();
  };

  // Optimistic: the dragged row stays where it was dropped while the order
  // saves; a failure refetches and reports.
  const reorder = async (environment: string, orderedIds: string[]) => {
    setActionError(null);
    const others = overrides.filter((o) => o.environment !== environment);
    const moved = orderedIds
      .map((id) => overrides.find((o) => o.id === id))
      .filter((o): o is ExperimentQaOverrideWithStatus => !!o);
    const next = [...others, ...moved].map((o, i) => ({ ...o, order: i }));
    try {
      await mutate(
        async () => {
          await apiCall(`/qa-overrides/experiment/${experiment.id}/order`, {
            method: "PUT",
            body: JSON.stringify({ overrideIds: next.map((o) => o.id) }),
          });
          return undefined;
        },
        {
          optimisticData: data ? { ...data, overrides: next } : undefined,
          rollbackOnError: true,
          revalidate: true,
        },
      );
    } catch (e) {
      setActionError(e.message);
    }
  };

  const header = (title: boolean) => (
    <Flex align="center" gap="2" mb={title ? "3" : "0"}>
      <Heading as="h4" size="sm" mb="0">
        QA Overrides
      </Heading>
      {title && <InfoTip content={ABOUT} />}
      <Box flexGrow="1" />
      {title && canAdd && (
        <Button
          variant="outline"
          size="sm"
          icon={<PiPlusBold />}
          onClick={() => setModal({ mode: "create" })}
        >
          Add Override
        </Button>
      )}
    </Flex>
  );

  // Empty states are a small centered card; a populated table spans the panel.
  if (overrides.length === 0 && !error) {
    const allProduction = eligibleEnvironments.length === 0;
    return (
      <>
        <Separator size="4" my="5" />
        <Frame
          mx="auto"
          py="5"
          px="6"
          style={{ maxWidth: `min(${EMPTY_CARD_WIDTH}px, 100%)` }}
        >
          <Flex direction="column" align="center" gap="2">
            <Heading as="h4" size="sm" mb="0">
              QA Overrides
            </Heading>
            <Box maxWidth="440px">
              <Text color="text-mid" align="center">
                {allProduction
                  ? "QA overrides only run in non-production environments, and every environment in this organization is marked as production."
                  : "Serve this draft to yourself or your team in a non-production environment before it starts."}
              </Text>
            </Box>
            {allProduction ? (
              <Link href="/environments" mt="2">
                Manage Environments →
              </Link>
            ) : canAdd ? (
              <Box mt="2">
                <Button
                  variant="outline"
                  icon={<PiPlusBold />}
                  onClick={() => setModal({ mode: "create" })}
                >
                  Add Override
                </Button>
              </Box>
            ) : null}
          </Flex>
        </Frame>
        {modal && (
          <QaOverrideModal
            experiment={experiment}
            linkedFeatures={linkedFeatures}
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

  return (
    <>
      <Separator size="4" my="5" />
      <Frame py="4" px="4" style={{ alignSelf: "stretch" }}>
        {modal && (
          <QaOverrideModal
            experiment={experiment}
            linkedFeatures={linkedFeatures}
            existing={modal.mode === "edit" ? modal.override : undefined}
            close={() => setModal(null)}
            onSaved={async () => {
              await mutate();
              setModal(null);
            }}
          />
        )}
        {header(true)}
        {error && (
          <Callout status="error" mb="3">
            Could not load QA overrides: {error.message}
          </Callout>
        )}
        {actionError && (
          <Callout status="error" mb="3">
            {actionError}
          </Callout>
        )}
        {overrides.length > 0 && (
          <QaOverridesTable
            groups={groups}
            leading="environment"
            grouped={grouped}
            // Order only matters with a Feature Flag; Visual Editor and URL
            // Redirect changes each ship as their own experiment copy.
            reorderable={grouped && !!linkedFeatures?.length}
            lookups={lookups}
            canEdit={(row) => canEditIn(row.override.environment)}
            onEdit={(row) => setModal({ mode: "edit", override: row.override })}
            onRemove={remove}
            removeConfirmation={(row) =>
              `This draft will stop being served to ${row.override.environment} through this override.`
            }
            onReorder={reorder}
          />
        )}
      </Frame>
    </>
  );
}
