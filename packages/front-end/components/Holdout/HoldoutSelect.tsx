import { useEffect, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { PiArrowSquareOut, PiLightbulb } from "react-icons/pi";
import { Flex, Text } from "@radix-ui/themes";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import PremiumCallout from "../Radix/PremiumCallout";
import Callout from "../Radix/Callout";
import Link from "../Radix/Link";

export const HoldoutSelect = ({
  selectedProject,
  setHoldout,
  selectedHoldoutId,
}: {
  selectedProject?: string;
  setHoldout: (holdoutId: string) => void;
  selectedHoldoutId: string | undefined;
}) => {
  const { project } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const { holdouts, experimentsMap } = useExperiments(
    project,
    false,
    "holdout",
  );
  const hasHoldouts = hasCommercialFeature("holdouts");

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts
      .filter((h) => {
        const experiment = experimentsMap.get(h.experimentId);
        // If the holdout was previously selected, show it
        if (selectedHoldoutId === h.id) {
          return true;
        }

        // If the holdout is a part of the current project or all projects, show it
        if (selectedProject) {
          return (
            h.projects.length === 0 || h.projects.includes(selectedProject)
          );
        }

        // If the holdout is in draft or is in the analysis period, don't show it
        if (!!h.analysisStartDate || experiment?.status === "draft") {
          return false;
        }
        // If the holdout is a part of the current project or all projects, show it
        return selectedProject
          ? h.projects.length === 0 || h.projects.includes(selectedProject)
          : true;
      })
      .map((holdout) => ({
        ...holdout,
        experiment: experimentsMap.get(
          holdout.experimentId,
        ) as ExperimentInterfaceStringDates,
      }));
  }, [holdouts, experimentsMap, selectedHoldoutId, selectedProject]);

  useEffect(() => {
    const current = selectedHoldoutId;
    // If still loading, don't set anything
    if (holdoutsWithExperiment === undefined) return;

    if (holdoutsWithExperiment.length === 0) {
      // Only set to 'none' if there are truly no holdouts
      setHoldout("none");
      return;
    }

    // If there are holdouts, and the value is empty, invalid, or 'none', set to the first holdout
    if (
      !current ||
      (!holdoutsWithExperiment.find((h) => h.id === current) &&
        current !== "none")
    ) {
      setHoldout(holdoutsWithExperiment[0].id);
    }
  }, [selectedProject, holdoutsWithExperiment, selectedHoldoutId, setHoldout]);

  if (holdoutsWithExperiment.length === 0) {
    if (!hasHoldouts) {
      return (
        <PremiumCallout
          id="holdout-select-promo"
          commercialFeature="holdouts"
          mt="5"
        >
          <Flex direction="row" gap="3">
            <Text>
              Use Holdouts to isolate units and measure the true impact of
              changes.
            </Text>
          </Flex>
        </PremiumCallout>
      );
    } else {
      return (
        <Callout mt="5" status="info" icon={<PiLightbulb size={15} />}>
          Use <strong>Holdouts</strong> to isolate units and measure the true
          impact of changes. {/* TODO: Replace with link to holdout docs */}
          <Link target="_blank" href="https://docs.growthbook.io/">
            Show me how <PiArrowSquareOut size={15} />
          </Link>
        </Callout>
      );
    }
  }

  return (
    <SelectField
      label="Holdout"
      labelClassName="font-weight-bold"
      value={selectedHoldoutId || "none"}
      onChange={(v) => {
        setHoldout(v);
      }}
      helpText={holdoutsWithExperiment.length === 0 ? "No holdouts" : undefined}
      options={[
        ...(holdoutsWithExperiment?.map((h) => {
          return {
            label: h.name,
            value: h.id,
          };
        }) || []),
        { label: "None", value: "none" },
      ]}
      required={holdoutsWithExperiment.length > 0}
      disabled={holdoutsWithExperiment.length === 0}
      sort={false}
      formatOptionLabel={({ label, value }) => {
        const userIdType = holdoutsWithExperiment?.find((h) => h.id === value)
          ?.experiment.exposureQueryId;
        return (
          <div className="cursor-pointer">
            {label}
            {userIdType ? (
              <span
                className="text-muted small float-right position-relative"
                style={{ top: 3, cursor: "pointer" }}
              >
                Identifier Type: <code>{userIdType}</code>
              </span>
            ) : null}
          </div>
        );
      }}
    />
  );
};
