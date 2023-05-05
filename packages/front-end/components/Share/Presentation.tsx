import React, { Fragment, ReactElement } from "react";
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
import CompactResults from "../Experiment/CompactResults";
import Markdown from "../Markdown/Markdown";
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
  // make sure experiments are in the right order - we know the order is
  // right in the presentation object. This could be done in the API
  const em = new Map<
    string,
    {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }
  >();
  experiments.forEach((e) => {
    em.set(e.experiment.id, e);
  });

  const expSlides = [];
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
    const variationExtra = [];
    let sideExtra = <></>;
    const variationsPlural =
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      e.experiment.variations.length > 2 ? "variations" : "variation";

    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    e.experiment.variations.forEach((v, i) => {
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Element' is not assignable to type 'never'.
      variationExtra[i] = <Fragment key={`f-${i}`}></Fragment>;
    });
    let resultsText = "";
    if (
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      e.experiment?.status === "running" ||
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      e.experiment?.status === "draft"
    ) {
      resultsText = "This experiment is still in progress";
    } else {
      // stopped:
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      if (e.experiment?.results) {
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        if (e.experiment.results === "won") {
          // if this is a two sided test, mark the winner:
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          variationExtra[e.experiment.winner] = (
            <Appear>
              <Text className="result variation-result result-winner text-center p-2 m-0">
                Winner!
              </Text>
            </Appear>
          );
          resultsText =
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            e.experiment.variations[e.experiment.winner]?.name +
            " beat the control and won";
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        } else if (e.experiment.results === "lost") {
          resultsText = `The ${variationsPlural} did not improve over the control`;

          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          if (e.experiment.variations.length === 2) {
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Element' is not assignable to type 'never'.
            variationExtra[1] = (
              <Appear>
                <Text className="result variation-result result-lost text-center p-2 m-0">
                  Lost!
                </Text>
              </Appear>
            );
          } else {
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Element' is not assignable to type 'never'.
            variationExtra[0] = (
              <Appear>
                <Text className="result variation-result result-winner text-center p-2 m-0">
                  Winner!
                </Text>
              </Appear>
            );
          }
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        } else if (e.experiment.results === "dnf") {
          sideExtra = (
            <div className="result result-dnf text-center">
              (Did not finish)
            </div>
          );
          resultsText = `The experiment did not finish`;
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
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
      // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'Element' is not assignable to pa... Remove this comment to see the full error message
      <Slide key={expSlides.length}>
        <div className="container-fluid">
          {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
          <Heading className="m-0 pb-0">{e.experiment.name}</Heading>
          <Text className="text-center m-0 mb-4 p-2" fontSize={21}>
            {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
            {e.experiment.hypothesis}
          </Text>
          <div className="row variations">
            {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
            {e.experiment.variations.map((v: Variation, j: number) => (
              <Text
                fontSize={20}
                className={`col m-0 p-0 col-${
                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  12 / e.experiment.variations.length
                } presentationcol text-center`}
                key={`v-${j}`}
              >
                <h4>{v.name}</h4>
                <img
                  className="expimage border"
                  src={v.screenshots[0] && v.screenshots[0].path}
                />
                {variationExtra[j]}
              </Text>
            ))}
          </div>
          {sideExtra}
        </div>
      </Slide>
    );
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    if (e.snapshot) {
      // const variationNames = e.experiment.variations.map((v) => v.name);
      // const numMetrics = e.experiment.metrics.length;
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      const result = e.experiment.results;

      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      const experiment = e.experiment;
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      const snapshot = e.snapshot;
      const phase = experiment.phases[snapshot.phase];

      expSlides.push(
        // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'Element' is not assignable to pa... Remove this comment to see the full error message
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
              {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
              {e.experiment.analysis && (
                <div className="card text-dark mt-2">
                  <div className="card-body">
                    <Markdown className="card-text">
                      {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
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
              padding: "0 0",
              color: "#444",
              fontSize: "95%",
            }}
          >
            <CompactResults
              id={experiment.id}
              isLatestPhase={snapshot.phase === experiment.phases.length - 1}
              metrics={experiment.metrics}
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'MetricOverride[] | undefined' is not assigna... Remove this comment to see the full error message
              metricOverrides={experiment.metricOverrides}
              reportDate={snapshot.dateCreated}
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentReportResultDimension | undefined'... Remove this comment to see the full error message
              results={snapshot.results?.[0]}
              status={experiment.status}
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
              startDate={phase?.dateStarted}
              multipleExposures={snapshot.multipleExposures || 0}
              variations={experiment.variations.map((v, i) => {
                return {
                  id: v.key || i + "",
                  name: v.name,
                  weight: phase?.variationWeights?.[i] || 0,
                };
              })}
            />
          </div>
        </Slide>
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
