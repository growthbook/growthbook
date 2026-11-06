import { FC, useRef } from "react";
import { getAllVariations } from "shared/experiments";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  ExperimentResultsType,
} from "shared/types/experiment";
import { computeAIUsageData, formatAIRateLimitRetryMessage } from "shared/ai";
import { useForm } from "react-hook-form";
import { experimentHasLinkedChanges, parseIntWithDefault } from "shared/util";
import { Flex, Separator } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SelectField from "@/components/Forms/SelectField";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import { DocLink } from "@/components/DocLink";
import DatePicker from "@/components/DatePicker";
import {
  decidedVariations,
  DecisionRecommendation,
  useRecommendedShip,
} from "@/components/Experiment/TabbedPage/RunningExperimentDecisionBanner";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { coveragePercentFormatter } from "@/services/utils";
import { Results } from "./ResultsIndicator";

const StopExperimentForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus?: ExperimentResultStatusData;
  decisionCriteria?: DecisionCriteriaData;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
  close,
  mutate,
  source,
}) => {
  const isBandit = experiment.type == "multi-armed-bandit";
  const isStopped = experiment.status === "stopped";

  const hasLinkedChanges = experimentHasLinkedChanges(experiment);

  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestionRef = useRef<string | undefined>(undefined);

  const aiSuggestFunction = async (): Promise<string> => {
    const aiTemperature =
      gb.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1;
    const response = await apiCall<{
      status: number;
      data: {
        description: string;
      };
    }>(
      `/experiment/${experiment.id}/analysis/ai-suggest`,
      {
        method: "POST",
        body: JSON.stringify({
          results: form.watch("results"),
          winner: form.watch("winner"),
          releasedVariationId: form.watch("releasedVariationId"),
          temperature: aiTemperature,
        }),
      },
      (responseData) => {
        if (responseData.status === 429) {
          throw new Error(
            formatAIRateLimitRetryMessage(responseData.retryAfter),
          );
        } else if (responseData.message) {
          throw new Error(responseData.message);
        } else {
          throw new Error("Error getting AI suggestion");
        }
      },
    );
    return response.data.description;
  };

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];

  const recommendedShip = useRecommendedShip(
    experiment,
    runningExperimentStatus,
  );
  const getRecommendedResult = (
    recommendation?: ExperimentResultStatusData,
    controlVariationId?: string,
  ): { result?: Results; releasedVariationId?: string } => {
    if (recommendation?.status === "ship-now") {
      return {
        result: "won",
        releasedVariationId: recommendedShip ?? undefined,
      };
    }
    if (recommendation?.status === "rollback-now") {
      return { result: "lost", releasedVariationId: controlVariationId };
    }
    return {};
  };

  const variations = getAllVariations(experiment);
  const {
    result: recommendedResult,
    releasedVariationId: recommendedReleaseVariationId,
  } = getRecommendedResult(runningExperimentStatus, variations?.[0]?.id);

  const recommendedReleaseVariationIndex = recommendedReleaseVariationId
    ? variations.findIndex((v) => v.id === recommendedReleaseVariationId)
    : undefined;

  const form = useForm<{
    reason: string;
    winner: number;
    releasedVariationId: string;
    excludeFromPayload: boolean;
    analysis: string;
    results: Results;
    dateEnded: string;
  }>({
    defaultValues: {
      reason: "",
      winner: experiment.winner ?? recommendedReleaseVariationIndex ?? 0,
      releasedVariationId:
        experiment.releasedVariationId || recommendedReleaseVariationId || "",
      excludeFromPayload: !!experiment.excludeFromPayload,
      analysis: experiment.analysis || "",
      results: experiment.results || recommendedResult,
      dateEnded: new Date().toISOString(),
    },
  });

  const decisionDoesNotMatchRecommendedResult =
    recommendedResult && form.watch("results") !== recommendedResult;
  const variationDoesNotMatchRecommendedReleaseVariationId =
    !decisionDoesNotMatchRecommendedResult &&
    recommendedReleaseVariationId !== undefined &&
    form.watch("releasedVariationId") !== recommendedReleaseVariationId;
  const winnerDoesNotMatchRecommendedReleaseVariationId =
    !decisionDoesNotMatchRecommendedResult &&
    recommendedReleaseVariationId !== undefined &&
    variations?.[form.watch("winner")]?.id !== recommendedReleaseVariationId;
  const { apiCall } = useAuth();

  // What users in it get once it stops serving: a flag's rule stays on the
  // flag but leaves the payload, and visual changes and redirects drop out.
  const noun = isBandit ? "Bandit" : "experiment";
  const flags = experiment.linkedFeatures ?? [];
  const visual = !!experiment.hasVisualChangesets;
  const redirects = !!experiment.hasURLRedirects;
  const pageChanges = visual || redirects;
  const pageKinds =
    visual && redirects
      ? "visual changes and URL redirects"
      : visual
        ? "visual changes"
        : "URL redirects";
  const pageStops = visual && !redirects ? "stop showing" : "stop";
  const pageSeen =
    visual && redirects
      ? "see the original pages"
      : visual
        ? "see the page without them"
        : "stay on the original URL";
  const oneFlag = flags.length === 1;
  const withoutRollout =
    flags.length || pageChanges ? (
      <>
        {flags.length ? (
          <>
            Without a temporary rollout,{" "}
            {oneFlag ? (
              <>
                the linked Feature Flag <strong>{flags[0]}</strong> stops
              </>
            ) : (
              `the ${flags.length} linked Feature Flags stop`
            )}{" "}
            serving this {noun} when you submit. For users in the {noun},{" "}
            {oneFlag ? "the" : "each"} flag then checks the rules below this{" "}
            {noun}&apos;s rule, in order. Users who match none of them get{" "}
            {oneFlag ? "the" : "that"} flag&apos;s default value.
          </>
        ) : null}
        {pageChanges
          ? flags.length
            ? ` The ${noun}'s ${pageKinds} ${pageStops} too. Users ${pageSeen}.`
            : `Without a temporary rollout, this ${noun}'s ${pageKinds} ${pageStops} when you submit. Users in the ${noun} ${pageSeen}.`
          : null}
      </>
    ) : null;

  const variationOption = (index: number) =>
    variations[index] ? (
      <VariationLabel
        number={index}
        name={variations[index].name}
        disableTooltip
      />
    ) : null;

  const decision =
    runningExperimentStatus &&
    decisionCriteria &&
    decidedVariations(experiment, runningExperimentStatus).length
      ? { runningExperimentStatus, decisionCriteria }
      : null;

  const submit = form.handleSubmit(async (value) => {
    let winner = -1;
    if (value.results === "lost") {
      winner = 0;
    } else if (value.results === "won") {
      if (variations.length === 2) {
        winner = 1;
      } else {
        winner = value.winner;
      }
    }

    const body = {
      ...value,
      winner,
    };

    await apiCall<{ status: number; message?: string }>(
      isStopped
        ? `/experiment/${experiment.id}`
        : `/experiment/${experiment.id}/stop`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    const aiUsageData = computeAIUsageData({
      value: value.analysis,
      aiSuggestionText: aiSuggestionRef.current,
    });
    track("Stop Experiment", {
      result: value.results,
      isStopped,
      aiUsageData,
    });

    mutate();
  });

  return (
    <ModalStandard
      trackingEventModalType="stop-experiment-form"
      trackingEventModalSource={source}
      header={
        isStopped
          ? `Edit ${isBandit ? "Bandit" : "Experiment"} Results`
          : `Stop ${isBandit ? "Bandit" : "Experiment"}`
      }
      size="lg"
      close={close}
      open
      submit={submit}
      cta={isStopped ? "Save" : "Stop"}
      ctaColor={isStopped ? "violet" : "red"}
    >
      <Flex direction={"column"} gap={"1"}>
        {decision ? (
          <>
            <Flex direction="column" gap="1">
              <Text as="label" weight="semibold">
                Recommendation
              </Text>
              <DecisionRecommendation
                experiment={experiment}
                runningExperimentStatus={decision.runningExperimentStatus}
                decisionCriteria={decision.decisionCriteria}
              />
            </Flex>
            <Separator size="4" mt="3" mb="4" />
          </>
        ) : null}
        <Flex direction={"column"} gap="0">
          <div className="row">
            <SelectField
              size="legacy"
              label="Conclusion"
              isSearchable={false}
              containerClassName="col-lg"
              className={decisionDoesNotMatchRecommendedResult ? "warning" : ""}
              value={form.watch("results")}
              onChange={(v) => {
                const result = v as ExperimentResultsType;
                form.setValue("results", result);

                if (result === "dnf" || result === "inconclusive") {
                  form.setValue("excludeFromPayload", true);
                  form.setValue("releasedVariationId", "");
                  form.setValue("winner", 0);
                } else if (result === "won") {
                  form.setValue("excludeFromPayload", false);
                  form.setValue(
                    "winner",
                    recommendedReleaseVariationIndex ?? 1,
                  );
                  form.setValue(
                    "releasedVariationId",
                    recommendedReleaseVariationId ?? (variations[1]?.id || ""),
                  );
                } else if (result === "lost") {
                  form.setValue("excludeFromPayload", true);
                  form.setValue("winner", 0);
                  form.setValue("releasedVariationId", variations[0]?.id || "");
                }
              }}
              placeholder="Pick one..."
              required
              options={[
                { label: "Did Not Finish", value: "dnf" },
                { label: "Won", value: "won" },
                { label: "Lost", value: "lost" },
                { label: "Inconclusive", value: "inconclusive" },
              ]}
            />
            {form.watch("results") === "won" && variations.length > 2 && (
              <SelectField
                size="legacy"
                label="Winner"
                isSearchable={false}
                containerClassName="col-lg"
                className={
                  decisionDoesNotMatchRecommendedResult ? "warning" : ""
                }
                value={form.watch("winner") + ""}
                onChange={(v) => {
                  form.setValue("winner", parseIntWithDefault(v, 0));

                  form.setValue(
                    "releasedVariationId",
                    variations[parseIntWithDefault(v, 0)]?.id ||
                      form.watch("releasedVariationId"),
                  );
                }}
                options={variations.slice(1).map((v, i) => {
                  return { value: i + 1 + "", label: v.name };
                })}
                sort={false}
                formatOptionLabel={(o) =>
                  variationOption(parseIntWithDefault(o.value, 0))
                }
              />
            )}
          </div>
          {decisionDoesNotMatchRecommendedResult ||
          winnerDoesNotMatchRecommendedReleaseVariationId ? (
            <Callout status="warning" mb="3" mt="-2">
              Conclusion does not match the recommendation.
            </Callout>
          ) : null}
        </Flex>
        {!isStopped && !hasLinkedChanges && (
          <DatePicker
            label="End time"
            timeZone="utc"
            date={form.watch("dateEnded")}
            setDate={(v) => {
              form.setValue("dateEnded", v ? v.toISOString() : "");
            }}
          />
        )}
        {hasLinkedChanges && (
          <>
            <div className="row">
              <div className="form-group col">
                <Checkbox
                  id="excludeFromPayload"
                  label="Enable temporary rollout"
                  value={!form.watch("excludeFromPayload")}
                  setValue={(includeInPayload) => {
                    form.setValue("excludeFromPayload", !includeInPayload);
                  }}
                  description={
                    <>
                      GrowthBook keeps serving the variation below until you
                      ship the change in code and end the rollout.{" "}
                      <DocLink useRadix={false} docSection="temporaryRollout">
                        Learn more
                      </DocLink>
                    </>
                  }
                />
              </div>
            </div>

            {!form.watch("excludeFromPayload") &&
            (lastPhase?.coverage ?? 1) < 1 ? (
              <Callout status="warning" mb="2" mt="-2">
                Currently only{" "}
                <strong>
                  {coveragePercentFormatter.format(lastPhase.coverage)}
                </strong>{" "}
                of traffic is directed at this experiment.
                <br />
                Upon rollout, <strong>100%</strong> of traffic will be directed
                towards the released variation.
              </Callout>
            ) : null}

            {!form.watch("excludeFromPayload") ? (
              <>
                <div className="row">
                  <SelectField
                    size="legacy"
                    label="Variation to Release"
                    isSearchable={false}
                    containerClassName="col"
                    value={form.watch("releasedVariationId")}
                    onChange={(v) => {
                      form.setValue("releasedVariationId", v);
                    }}
                    helpText={
                      // Body size, past the legacy field's small print.
                      <Text size="md" color="text-mid">
                        Served to every user who meets the {noun}&apos;s
                        targeting.
                      </Text>
                    }
                    placeholder="Pick one..."
                    required
                    options={variations.map((v) => {
                      return { value: v.id, label: v.name };
                    })}
                    sort={false}
                    formatOptionLabel={(o) =>
                      variationOption(
                        variations.findIndex((v) => v.id === o.value),
                      )
                    }
                  />
                </div>
                {variationDoesNotMatchRecommendedReleaseVariationId ? (
                  <Callout status="warning" mb="3" mt="-2">
                    Variation selected does not match the recommendation.
                  </Callout>
                ) : null}
              </>
            ) : withoutRollout ? (
              <Callout status="info" mb="3" mt="-2">
                {withoutRollout}
              </Callout>
            ) : null}
          </>
        )}

        <div className="row">
          <div className="form-group col-lg">
            <Text as="label" weight="semibold">
              Additional Analysis or Details
            </Text>
            <AIRichTextField
              value={form.watch("analysis") ?? ""}
              onChange={(val) => form.setValue("analysis", val)}
              aiSuggestFunction={aiSuggestFunction}
              aiButtonText="Generate Analysis"
              trackingSource="stop-experiment"
              collapsibleToolbar
              onAISuggestionReceived={(result) => {
                aiSuggestionRef.current = result;
              }}
            />
          </div>
        </div>
      </Flex>
    </ModalStandard>
  );
};

export default StopExperimentForm;
