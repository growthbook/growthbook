import React, { Fragment, ReactElement, useEffect } from "react";
import {
  Deck,
  Slide,
  Heading,
  FlexBox,
  Box,
  Progress,
  FullScreen,
  Appear,
  Text,
} from "spectacle";
import { PresentationInterface } from "back-end/types/presentation";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import Markdown from "@/components/Markdown/Markdown";
import useOrgSettings from "@/hooks/useOrgSettings";
import CompactResults from "@/components/Experiment/CompactResults";
import AuthorizedImage from "@/components/AuthorizedImage";
import { presentationThemes, defaultTheme } from "./ShareModal";

export interface Props {
  presentation?: PresentationInterface;
  theme?: string;
  title?: string;
  desc?: string;
  customTheme?: {
    backgroundColor: string;
    textColor: string;
    headingFont?: string;
    bodyFont?: string;
  };
  experiments: {
    experiment: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
  }[];
  preview?: boolean;
}

const Presentation = ({
  presentation,
  experiments,
  theme = defaultTheme,
  title,
  desc,
  customTheme,
  preview = false,
}: Props): ReactElement => {
  const { getExperimentMetricById } = useDefinitions();
  const orgSettings = useOrgSettings();

  // Image cache for AuthorizedImage component
  const [imageCache] = React.useState<
    Record<string, { url: string; expiresAt: string }>
  >({});

  // Interval to force the results table to redraw (currently needed for window-size-based rendering)
  // - ideally would have rerendered on slide number, but spectacle doesn't seem to expose this
  const [redraw, setRedraw] = React.useState(false);
  useEffect(() => {
    setRedraw(true);
    const interval = window.setInterval(() => {
      setRedraw((r) => !r);
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const em = new Map<
    string,
    {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }
  >();

  experiments.forEach((e) => {
    em.set(e?.experiment?.id ?? "", e);
  });

  const expSlides: JSX.Element[] = [];
  // use the list of experiments from the presentation or, if missing the
  // presentation (in the case of preview), from the list of experiments
  // passed in.
  (
    presentation?.slides.map((o) => o.id) ||
    experiments.map((e) => {
      return e.experiment.id;
    })
  ).forEach((eid) => {
    // get the results in the right shape:
    const e = em.get(eid);
    // get the info on which variation to mark as winner/loser
    const variationExtra: JSX.Element[] = [];
    let sideExtra = <></>;
    const variationsPlural =
      (e?.experiment?.variations?.length || 0) !== 1
        ? "variations"
        : "variation";

    e?.experiment?.variations?.forEach((v, i) => {
      variationExtra[i] = <Fragment key={`f-${i}`}></Fragment>;
    });
    let resultsText = "";
    if (
      e?.experiment?.status === "running" ||
      e?.experiment?.status === "draft"
    ) {
      resultsText = "This experiment is still in progress";
    } else {
      // stopped:
      if (e?.experiment?.results) {
        const winningVar = e?.experiment?.winner || 0;
        if (e.experiment.results === "won") {
          // if this is a two sided test, mark the winner:
          variationExtra[winningVar] = (
            <Appear>
              <Text className="result variation-result result-winner text-center p-2 m-0">
                Winner!
              </Text>
            </Appear>
          );
          resultsText =
            (e?.experiment?.variations[winningVar]?.name ?? "") +
            " beat the control and won";
        } else if (e.experiment.results === "lost") {
          resultsText = `The ${variationsPlural} did not improve over the control`;

          if (e.experiment.variations.length === 2) {
            variationExtra[1] = (
              <Appear>
                <Text className="result variation-result result-lost text-center p-2 m-0">
                  Lost!
                </Text>
              </Appear>
            );
          } else {
            variationExtra[0] = (
              <Appear>
                <Text className="result variation-result result-winner text-center p-2 m-0">
                  Winner!
                </Text>
              </Appear>
            );
          }
        } else if (e.experiment.results === "dnf") {
          sideExtra = (
            <div className="result result-dnf text-center">
              (Did not finish)
            </div>
          );
          resultsText = `The experiment did not finish`;
        } else if (e.experiment.results === "inconclusive") {
          sideExtra = (
            <Appear>
              <Text className="result result-inconclusive text-center m-0 p-3">
                Inconclusive
              </Text>
            </Appear>
          );
          resultsText = `The results were inconclusive`;
        }
      }
    }

    expSlides.push(
      <Slide key={expSlides?.length ?? 0}>
        <div className="container-fluid">
          <Heading className="m-0 pb-0">
            {e?.experiment?.name ?? "Experiment"}
          </Heading>
          <Text className="text-center m-0 mb-4 p-2 px-5" fontSize={21}>
            {e?.experiment?.hypothesis
              ? "Hypothesis: " + e.experiment.hypothesis
              : ""}
            {e?.experiment?.goalMetrics && (
              <>
                <br />
                <span style={{ fontSize: "1rem" }}>
                  Primary metrics:{" "}
                  {e?.experiment?.goalMetrics
                    .map((m) => getExperimentMetricById(m)?.name ?? m)
                    .join(", ")}
                </span>
              </>
            )}
          </Text>

          <div className="row variations">
            {e?.experiment?.variations.map((v: Variation, j: number) => (
              <Text
                fontSize={20}
                className={`col m-0 p-0 col-${
                  12 / e.experiment.variations.length
                } presentationcol text-center`}
                key={`v-${j}`}
              >
                <h4>{v.name}</h4>
                {v?.screenshots[0]?.path && (
                  <AuthorizedImage
                    className="expimage border"
                    src={v.screenshots[0].path}
                    alt={v.name}
                    imageCache={imageCache}
                  />
                )}
                {v.description && (
                  <div
                    className="text-center"
                    style={{ fontSize: "16px", opacity: 0.8 }}
                  >
                    {v.description}
                  </div>
                )}
                {variationExtra[j]}
              </Text>
            ))}
          </div>
          {sideExtra}
        </div>
      </Slide>,
    );
    if (e?.snapshot) {
      // const variationNames = e.experiment.variations.map((v) => v.name);
      // const numMetrics = e.experiment.metrics.length;
      const result = e.experiment.results;

      const experiment = e.experiment;
      const snapshot = e.snapshot;
      const phase = experiment.phases[snapshot.phase];
      const settingsForSnapshotMetrics =
        snapshot?.settings?.metricSettings?.map((m) => ({
          metric: m.id,
          properPrior: m.computedSettings?.properPrior ?? false,
          properPriorMean: m.computedSettings?.properPriorMean ?? 0,
          properPriorStdDev:
            m.computedSettings?.properPriorStdDev ??
            DEFAULT_PROPER_PRIOR_STDDEV,
          regressionAdjustmentReason:
            m.computedSettings?.regressionAdjustmentReason || "",
          regressionAdjustmentDays:
            m.computedSettings?.regressionAdjustmentDays || 0,
          regressionAdjustmentEnabled:
            !!m.computedSettings?.regressionAdjustmentEnabled,
          regressionAdjustmentAvailable:
            !!m.computedSettings?.regressionAdjustmentAvailable,
        })) || [];

      expSlides.push(
        <Slide key={`s-${expSlides.length}`}>
          <Heading className="m-0 p-0">Results</Heading>
          {result && (
            <div
              className={clsx("alert", {
                "alert-success": result === "won",
                "alert-danger": result === "lost",
                "alert-info": !result || result === "inconclusive",
                "alert-warning": result === "dnf",
              })}
            >
              <strong>{resultsText}</strong>
              {e.experiment.analysis && (
                <div className="card text-dark mt-2">
                  <div className="card-body">
                    <Markdown className="card-text">
                      {e.experiment.analysis}
                    </Markdown>
                  </div>
                </div>
              )}
            </div>
          )}

          <div
            style={{
              overflowY: "auto",
              background: "#fff",
              maxHeight: "100%",
              color: "#444",
              fontSize: "95%",
            }}
          >
            <CompactResults
              experimentId={experiment.id}
              variations={experiment.variations.map((v, i) => {
                return {
                  id: v.key || i + "",
                  name: v.name,
                  weight: phase?.variationWeights?.[i] || 0,
                };
              })}
              multipleExposures={snapshot.multipleExposures || 0}
              results={snapshot?.analyses[0]?.results?.[0]}
              reportDate={snapshot.dateCreated}
              startDate={phase?.dateStarted ?? ""}
              endDate={phase?.dateEnded ?? ""}
              isLatestPhase={snapshot.phase === experiment.phases.length - 1}
              phase={snapshot.phase}
              status={experiment.status}
              goalMetrics={experiment.goalMetrics}
              secondaryMetrics={experiment.secondaryMetrics}
              guardrailMetrics={experiment.guardrailMetrics}
              metricOverrides={experiment.metricOverrides ?? []}
              id={experiment.id}
              statsEngine={snapshot?.analyses[0]?.settings.statsEngine}
              pValueCorrection={orgSettings?.pValueCorrection}
              settingsForSnapshotMetrics={settingsForSnapshotMetrics}
              sequentialTestingEnabled={
                snapshot?.analyses[0]?.settings?.sequentialTesting
              }
              differenceType={snapshot?.analyses[0]?.settings?.differenceType}
              isTabActive={redraw}
              mainTableOnly={true}
              noStickyHeader={true}
              noTooltip={true}
            />
          </div>
        </Slide>,
      );
    } else {
      expSlides.push(
        <Slide key={`s-${expSlides.length}`}>
          <Heading className="m-0 p-0">Results</Heading>
          <div className={clsx("alert", "alert-warning", "mt-3")}>
            <strong>No data for this experiment</strong>
          </div>
        </Slide>,
      );
    }
  });

  const template = () => (
    <FlexBox
      justifyContent="space-between"
      position="absolute"
      bottom={0}
      width={1}
    >
      <Box padding="0 1em">
        <FullScreen color="#fff" size={30} />
      </Box>
      <Box padding="1em">
        <Progress color="#fff" size={10} />
      </Box>
    </FlexBox>
  );

  const themeName = presentation?.theme ? presentation.theme : theme;
  const currentTheme = presentationThemes[themeName];

  if (themeName === "custom") {
    if (presentation?.customTheme) {
      // set in the presentation object from mongo:
      currentTheme.colors.tertiary = presentation.customTheme.backgroundColor;
      currentTheme.colors.primary = presentation.customTheme.textColor;
      currentTheme.colors.secondary = presentation.customTheme.textColor;
      if (!("fonts" in currentTheme))
        currentTheme.fonts = { header: "", text: "" };
      currentTheme.fonts.header = presentation.customTheme.headingFont;
      currentTheme.fonts.text = presentation.customTheme.bodyFont;
    } else {
      // the custom theme is set by a preview:
      if (!("fonts" in currentTheme))
        currentTheme.fonts = { header: "", text: "" };

      if (customTheme?.backgroundColor) {
        currentTheme.colors.tertiary = customTheme.backgroundColor;
      }
      if (customTheme?.textColor) {
        currentTheme.colors.primary = customTheme.textColor;
        currentTheme.colors.secondary = customTheme.textColor;
      }
      if (customTheme?.bodyFont) {
        currentTheme.fonts.text = customTheme.bodyFont;
      }
      if (customTheme?.headingFont) {
        currentTheme.fonts.header = customTheme.headingFont;
      }
    }
  }

  if (preview) {
    // we have to tweak a few things to make it work in a div
    currentTheme.Backdrop = "div";
    currentTheme.backdropStyle = {
      backgroundColor: "#ffffff",
    };
    currentTheme.size = {
      width: "100%",
      height: "100%",
      maxCodePaneHeight: 200,
    };
  }
  return (
    <div className={`presentation ${preview ? "presentation-preview" : ""}`}>
      <Deck theme={currentTheme} template={template}>
        <Slide>
          <FlexBox height="100%" className="flexwrap">
            <Heading fontSize={55}>
              {presentation?.title
                ? presentation.title
                : title
                  ? title
                  : "A/B Tests Review"}
              {presentation?.description ? (
                <Text className="subtitle" fontSize={20}>
                  {presentation.description}
                </Text>
              ) : desc ? (
                <Text className="subtitle" fontSize={20}>
                  {desc}
                </Text>
              ) : (
                ""
              )}
            </Heading>
          </FlexBox>
        </Slide>
        {expSlides}
        <Slide>
          <FlexBox height="100%" className="flexwrap">
            <Heading fontSize={55}>Thanks!</Heading>
          </FlexBox>
        </Slide>
      </Deck>
    </div>
  );
};

export default Presentation;
