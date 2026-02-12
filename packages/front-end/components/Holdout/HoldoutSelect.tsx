import { useEffect, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PiArrowSquareOut, PiLightbulb, PiWarningFill } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useHoldouts } from "@/hooks/useHoldouts";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import HelperText from "@/ui/HelperText";

export const HoldoutSelect = ({
  selectedProject,
  setHoldout,
  selectedHoldoutId,
  formType,
}: {
  selectedProject?: string;
  setHoldout: (holdoutId: string) => void;
  selectedHoldoutId: string | undefined;
  formType: "experiment" | "feature";
}) => {
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const { holdouts, experimentsMap } = useHoldouts();

  const hasHoldouts = hasCommercialFeature("holdouts");

  const holdoutsWithExperiment = useMemo(() => {
    const filteredHoldouts = holdouts.filter((h) => {
      if (!selectedProject && h.projects.length > 0) {
        return false;
      }

      const experiment = experimentsMap.get(h.experimentId);

      // If the holdout is in draft or is in the analysis period, don't show it
      if (!!h.analysisStartDate || experiment?.status === "draft") {
        return false;
      }
      // If the holdout is a part of the current project or all projects, show it
      return selectedProject
        ? h.projects.length === 0 || h.projects.includes(selectedProject)
        : true;
    });

    return filteredHoldouts.map((holdout) => {
      const experiment = experimentsMap.get(holdout.experimentId);
      const datasource = experiment?.datasource
        ? getDatasourceById(experiment?.datasource ?? "")
        : null;
      const exposureQueries = datasource?.settings?.queries?.exposure || [];
      const userIdType = experiment
        ? exposureQueries?.find((e) => e.id === experiment.exposureQueryId)
            ?.userIdType
        : "";
      return {
        ...holdout,
        experiment: experimentsMap.get(
          holdout.experimentId,
        ) as ExperimentInterfaceStringDates,
        userIdType,
      };
    });
  }, [holdouts, experimentsMap, selectedProject, getDatasourceById]);

  useEffect(() => {
    // check to see if the holdout still exists and if not, set the holdout to the first valid holdout
    if (!holdoutsWithExperiment.some((h) => h.id === selectedHoldoutId)) {
      setHoldout(holdoutsWithExperiment[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdoutsWithExperiment]);

  if (!hasHoldouts) {
    return (
      <PremiumCallout
        id="holdout-select-promo"
        commercialFeature="holdouts"
        dismissable={true}
        mt="3"
        mb="3"
      >
        <Flex direction="row" gap="3">
          <Text>
            Use Holdouts to isolate units and measure the cumulative impact of
            changes.
          </Text>
        </Flex>
      </PremiumCallout>
    );
  }

  if (holdoutsWithExperiment.length === 0) {
    return (
      <Callout
        mt="3"
        mb="3"
        status="info"
        icon={<PiLightbulb size={15} />}
        dismissible
        id="holdout-select-promo"
      >
        Use <strong>Holdouts</strong> to isolate units and measure the
        cumulative impact of changes.{" "}
        <Link target="_blank" href="https://docs.growthbook.io/app/holdouts">
          Show me how <PiArrowSquareOut size={15} />
        </Link>
      </Callout>
    );
  }

  return (
    <>
      <SelectField
        label="Holdout"
        labelClassName="font-weight-bold"
        value={selectedHoldoutId || ""}
        onChange={(v) => {
          setHoldout(v);
        }}
        helpText={
          holdoutsWithExperiment.length === 0 ? "No holdouts" : undefined
        }
        options={[
          ...(holdoutsWithExperiment?.map((h) => {
            return {
              label: h.name,
              value: h.id,
            };
          }) || []),
          { label: "None", value: "" },
        ]}
        disabled={holdoutsWithExperiment.length === 0}
        sort={false}
        formatOptionLabel={({ label, value }) => {
          const userIdType = holdoutsWithExperiment?.find(
            (h) => h.id === value,
          )?.userIdType;
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
              ) : value === "" ? (
                <span className="text-muted small float-right position-relative">
                  Override Holdout requirement{" "}
                  <PiWarningFill
                    style={{ color: "var(--amber-11)" }}
                    size={12}
                  />
                </span>
              ) : null}
            </div>
          );
        }}
      />
      {holdoutsWithExperiment.length > 0 && selectedHoldoutId === "" && (
        <HelperText status="warning" size="sm" mb="3">
          Exempting this {formType} from a holdout may impact your
          organization&apos;s analysis. Proceed with caution.
        </HelperText>
      )}
    </>
  );
};
