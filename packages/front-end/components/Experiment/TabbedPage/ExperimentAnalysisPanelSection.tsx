import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PanelSection } from "@/components/DetailsPanel";
import { PanelEditButton } from "@/components/DetailsPanelFields";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import AnalysisSettingInfo from "@/components/AnalysisSettingInfo";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import { getAnalysisSettingsDisplay } from "./analysisSettingsDisplay";
import styles from "./ExperimentAnalysisPanelSection.module.scss";

export default function ExperimentAnalysisPanelSection({
  experiment,
  envs,
  mutate,
  canEdit,
  editsBlocked,
  editOnSetup,
}: {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate: () => void;
  canEdit: boolean;
  editsBlocked: string | null;
  // On Setup the Analysis Plan is the editor; elsewhere a modal is.
  editOnSetup: (() => void) | null;
}) {
  const { snapshot, analysis } = useSnapshot();
  const { organization } = useUser();
  const { getSegmentById, getExperimentMetricById } = useDefinitions();
  const [formOpen, setFormOpen] = useState(false);

  const display = getAnalysisSettingsDisplay({
    experiment,
    snapshot,
    analysis,
    disablePrecomputedDimensions:
      !!organization?.settings?.disablePrecomputedDimensions,
  });
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getExperimentMetricById(
    experiment.activationMetric || "",
  );

  const adjustments: { label: string; info?: ReactNode }[] = [];
  if (display.cuped) {
    adjustments.push({
      label: "CUPED",
      info: (
        <AnalysisSettingInfo
          drilldownHint
          ariaLabel="How CUPED affects results"
          description="CUPED adjusts for pre-exposure mean imbalances across variations to reduce variance."
        />
      ),
    });
  }
  if (display.postStratification) {
    adjustments.push({
      label: "Post-Stratification",
      info: (
        <AnalysisSettingInfo
          drilldownHint
          ariaLabel="How post-stratification affects results"
          description="Post-stratification adjusts for within-dimension imbalances to reduce variance."
        />
      ),
    });
  }
  if (display.sequential) adjustments.push({ label: "Sequential" });

  const edit = editOnSetup ?? (() => setFormOpen(true));
  const editsOnClick = canEdit && !editsBlocked;

  return (
    <>
      {formOpen ? (
        <AnalysisForm
          cancel={() => setFormOpen(false)}
          experiment={experiment}
          envs={envs}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={false}
          editMetrics={true}
          editVariationIds={false}
          source="details-panel"
        />
      ) : null}
      <Box className={editsOnClick ? styles.editBlock : undefined}>
        <PanelSection
          title="Analysis"
          action={
            canEdit ? (
              <PanelEditButton
                label="Edit analysis settings"
                onClick={edit}
                blockedReason={editsBlocked}
              />
            ) : null
          }
        >
          <Flex
            direction="column"
            gap="3"
            className={editsOnClick ? styles.fields : undefined}
            // The pencil is the control; this spares pointing at it. A setting's
            // own info icon still answers for itself.
            onClick={
              editsOnClick
                ? (e) => {
                    const control = (e.target as HTMLElement).closest(
                      "a, button, [tabindex]",
                    );
                    if (!control || !e.currentTarget.contains(control)) edit();
                  }
                : undefined
            }
          >
            {display.hasData ? (
              <>
                <Metadata
                  size="sm"
                  stacked
                  label="Engine"
                  value={
                    <Flex align="center" gap="1">
                      <Text size="sm" color="text-high">
                        {display.engine}
                      </Text>
                      {display.priorUsed ? (
                        <AnalysisSettingInfo
                          drilldownHint
                          ariaLabel="How a Bayesian prior affects results"
                          description="A Bayesian prior shrinks the metric estimate towards the prior mean."
                        />
                      ) : null}
                    </Flex>
                  }
                />
                {adjustments.length > 0 ? (
                  <Metadata
                    size="sm"
                    stacked
                    label="Adjustments"
                    value={
                      <Flex gap="2" wrap="wrap">
                        {adjustments.map(({ label, info }) => (
                          <Flex key={label} align="center" gap="1">
                            <Badge label={label} color="gray" variant="soft" />
                            {info}
                          </Flex>
                        ))}
                      </Flex>
                    }
                  />
                ) : null}
                {segment ? (
                  <Metadata
                    size="sm"
                    stacked
                    label="Segment"
                    value={segment.name}
                  />
                ) : null}
                {activationMetric ? (
                  <Metadata
                    size="sm"
                    stacked
                    label="Activation metric"
                    value={activationMetric.name}
                  />
                ) : null}
                {display.lookbackEnforced ? (
                  <Metadata
                    size="sm"
                    stacked
                    label="Lookback enforced"
                    value={display.lookbackEnforced}
                  />
                ) : null}
              </>
            ) : (
              <Text size="sm" color="text-low">
                No results yet
              </Text>
            )}
          </Flex>
        </PanelSection>
      </Box>
    </>
  );
}
