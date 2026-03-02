import { FC, useRef, useState } from "react";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  ExperimentResultsType,
} from "shared/types/experiment";
import { computeAIUsageData } from "shared/ai";
import { useForm } from "react-hook-form";
import { experimentHasLinkedChanges } from "shared/util";
import { datetime } from "shared/dates";
import { getLatestPhaseVariations } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { DocLink } from "@/components/DocLink";
import DatePicker from "@/components/DatePicker";
import RunningExperimentDecisionBanner from "@/components/Experiment/TabbedPage/RunningExperimentDecisionBanner";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import { AppFeatures } from "@/types/app-features";
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
  const [showModal, setShowModal] = useState(true);
  const isBandit = experiment.type == "multi-armed-bandit";
  const isStopped = experiment.status === "stopped";

  const variations = getLatestPhaseVariations(experiment);

  const hasLinkedChanges = experimentHasLinkedChanges(experiment);

  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestionRef = useRef<string | undefined>(undefined);

  const aiSuggestFunction = gb.isOn(
    "ai-suggestions-for-experiment-analysis-input",
  )
    ? async (): Promise<string> => {
        // Only evaluate the feature flag if suggestion is requested
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
              const retryAfter = parseInt(responseData.retryAfter);
              const hours = Math.floor(retryAfter / 3600);
              const minutes = Math.floor((retryAfter % 3600) / 60);
              throw new Error(
                `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
              );
            } else if (responseData.message) {
              throw new Error(responseData.message);
            } else {
              throw new Error("Error getting AI suggestion");
            }
          },
        );
        return response.data.description;
      }
    : undefined;

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const getRecommendedResult = (
    recommendation?: ExperimentResultStatusData,
    controlVariationId?: string,
  ): { result?: Results; releasedVariationId?: string } => {
    if (recommendation?.status === "ship-now") {
      return {
        result: "won",
        releasedVariationId:
          recommendation.variations.length === 1
            ? recommendation.variations[0].variationId
            : undefined,
      };
    }
    if (recommendation?.status === "rollback-now") {
      return { result: "lost", releasedVariationId: controlVariationId };
    }
    return {};
  };

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
      dateEnded: new Date().toISOString().substr(0, 16),
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

  const decisionBanner =
    runningExperimentStatus && decisionCriteria
      ? RunningExperimentDecisionBanner({
          experiment,
          runningExperimentStatus,
          decisionCriteria,
          showDecisionCriteriaLink: false,
        })
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
    <Modal
      trackingEventModalType="stop-experiment-form"
      trackingEventModalSource={source}
      header={
        isStopped
          ? `Edit ${isBandit ? "Bandit" : "Experiment"} Results`
          : `Stop ${isBandit ? "Bandit" : "Experiment"}`
      }
      size="lg"
      close={close}
      open={showModal}
      submit={submit}
      cta={isStopped ? "Save" : "Stop"}
      submitColor={isStopped ? "primary" : "danger"}
      closeCta="Cancel"
    >
      <Flex direction={"column"} gap={"1"}>
        {decisionBanner ? (
          <>
            <Flex direction={"column"} gap="0">
              <label>Recommendation</label>
              {decisionBanner}
            </Flex>
            <hr className="m-1" />
          </>
        ) : null}
        <Flex direction={"column"} gap="0">
          <div className="row">
            <SelectField
              label="Conclusion"
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
                label="Winner"
                containerClassName="col-lg"
                className={
                  decisionDoesNotMatchRecommendedResult ? "warning" : ""
                }
                value={form.watch("winner") + ""}
                onChange={(v) => {
                  form.setValue("winner", parseInt(v) || 0);

                  form.setValue(
                    "releasedVariationId",
                    variations[parseInt(v)]?.id ||
                      form.watch("releasedVariationId"),
                  );
                }}
                options={variations.slice(1).map((v, i) => {
                  return { value: i + 1 + "", label: v.name };
                })}
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
            label="End Time (UTC)"
            date={form.watch("dateEnded")}
            setDate={(v) => {
              form.setValue("dateEnded", v ? datetime(v) : "");
            }}
          />
        )}
        {hasLinkedChanges && (
          <>
            <div className="row">
              <div className="form-group col">
                <Checkbox
                  id="excludeFromPayload"
                  label="Enable Temporary Rollout"
                  value={!form.watch("excludeFromPayload")}
                  setValue={(includeInPayload) => {
                    form.setValue("excludeFromPayload", !includeInPayload);
                  }}
                />

                <small className="form-text text-muted">
                  Keep the {isBandit ? "Bandit" : "Experiment"} running until
                  you can implement the changes in code.{" "}
                  <DocLink docSection="temporaryRollout">Learn more</DocLink>
                </small>
              </div>
            </div>

            {!form.watch("excludeFromPayload") &&
            (lastPhase?.coverage ?? 1) < 1 ? (
              <Callout status="warning" mb="2" mt="-2">
                Currently only{" "}
                <strong>{percentFormatter.format(lastPhase.coverage)}</strong>{" "}
                of traffic is directed at this experiment.
                <br />
                Upon rollout, <strong>100%</strong> of traffic will be directed
                towards the releeased variation.
              </Callout>
            ) : null}

            {!form.watch("excludeFromPayload") ? (
              <>
                <div className="row">
                  <SelectField
                    label="Variation to Release"
                    containerClassName="col"
                    value={form.watch("releasedVariationId")}
                    onChange={(v) => {
                      form.setValue("releasedVariationId", v);
                    }}
                    helpText="Send 100% of experiment traffic to this variation"
                    placeholder="Pick one..."
                    required
                    options={variations.map((v) => {
                      return { value: v.id, label: v.name };
                    })}
                  />
                </div>
                {variationDoesNotMatchRecommendedReleaseVariationId ? (
                  <Callout status="warning" mb="3" mt="-2">
                    Variation selected does not match the recommendation.
                  </Callout>
                ) : null}
              </>
            ) : form.watch("results") === "won" ? (
              <Callout status="info" mb="3" mt="-2">
                If you don&apos;t enable a Temporary Rollout, all experiment
                traffic will immediately revert to the default control
                experience when you submit this form.
              </Callout>
            ) : null}
          </>
        )}

        <div className="row">
          <div className="form-group col-lg">
            <label>Additional Analysis or Details</label>{" "}
            <MarkdownInput
              value={form.watch("analysis")}
              setValue={(val) => form.setValue("analysis", val)}
              aiSuggestFunction={aiSuggestFunction}
              aiButtonText="Generate Analysis"
              aiSuggestionHeader="Suggested Summary"
              trackingSource="stop-experiment"
              onAISuggestionReceived={(result) => {
                aiSuggestionRef.current = result;
              }}
              onOptInModalClose={() => {
                setShowModal(true);
              }}
              onOptInModalOpen={() => {
                setShowModal(false);
              }}
            />
          </div>
        </div>
      </Flex>
    </Modal>
  );
};

export default StopExperimentForm;
