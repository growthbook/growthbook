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
} from "spectacle";
import { PresentationInterface } from "back-end/types/presentation";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import CompactResults from "../Experiment/CompactResults";
import { presentationThemes, defaultTheme } from "./ShareModal";
import clsx from "clsx";
import Markdown from "../Markdown/Markdown";

type props = {
  presentation?: PresentationInterface;
  theme?: string;
  title?: string;
  desc?: string;
  customTheme?: {
    backgroundColor: string;
    textColor: string;
  };
  experiments: {
    experiment: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
  }[];
  preview?: boolean;
};

const Presentation = ({
  presentation,
  experiments,
  theme = defaultTheme,
  title,
  desc,
  customTheme,
  preview = false,
}: props): ReactElement => {
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
      e.experiment.variations.length > 2 ? "variations" : "variation";

    e.experiment.variations.forEach((v, i) => {
      variationExtra[i] = <Fragment key={`f-${i}`}></Fragment>;
    });
    let resultsText = "";
    if (
      e.experiment?.status === "running" ||
      e.experiment?.status === "draft"
    ) {
      resultsText = "This experiment is still in progress";
    } else {
      // stopped:
      if (e.experiment?.results) {
        if (e.experiment.results === "won") {
          // if this is a two sided test, mark the winner:
          variationExtra[e.experiment.winner] = (
            <Appear>
              <div className="result variation-result result-winner">
                Winner!
              </div>
            </Appear>
          );
          resultsText =
            e.experiment.variations[e.experiment.winner]?.name +
            " beat the control and won";
        } else if (e.experiment.results === "lost") {
          resultsText = `The ${variationsPlural} beat the control and won`;

          if (e.experiment.variations.length === 2) {
            variationExtra[1] = (
              <Appear>
                <div className="result variation-result result-lost">Lost!</div>
              </Appear>
            );
          } else {
            variationExtra[0] = (
              <Appear>
                {() => {
                  return (
                    <div className="result variation-result result-winner">
                      Winner!
                    </div>
                  );
                }}
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
              <div className="result result-inconclusive text-center">
                Inconclusive
              </div>
            </Appear>
          );
          resultsText = `The results were inconclusive`;
        }
      }
    }

    expSlides.push(
      <Slide key={expSlides.length}>
        <div className="container-fluid">
          <Heading className="m-0 pb-4">{e.experiment.name}</Heading>
          <h4 className="text-center mb-4 p-2" style={{ marginTop: -30 }}>
            {e.experiment.hypothesis}
          </h4>
          <div className="row variations">
            {e.experiment.variations.map((v: Variation, j: number) => (
              <div
                className={`col col-${
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
              </div>
            ))}
          </div>
          {sideExtra}
        </div>
      </Slide>
    );
    if (e.snapshot) {
      // const variationNames = e.experiment.variations.map((v) => v.name);
      // const numMetrics = e.experiment.metrics.length;
      const result = e.experiment.results;

      if (result)
        expSlides.push(
          <Slide key={`s-${expSlides.length}`}>
            <Heading>Results</Heading>
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
              <CompactResults snapshot={e.snapshot} experiment={e.experiment} />
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
    } else {
      // the custom theme is set by a preview:
      if (customTheme?.backgroundColor) {
        currentTheme.colors.tertiary = customTheme.backgroundColor;
      }
      if (customTheme?.textColor) {
        currentTheme.colors.primary = customTheme.textColor;
        currentTheme.colors.secondary = customTheme.textColor;
      }
    }
  }

  if (preview) {
    currentTheme.backdropStyle = {
      backgroundColor: "#ffffff",
      width: "100vw",
      height: "100vh",
      transformOrigin: "top left",
      transform: "scale(0.45)",
    };
    currentTheme.size = {
      width: "100%",
      height: "100%",
      maxCodePaneHeight: 200,
    };
  }

  return (
    <>
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
                <h3 className="subtitle">{presentation.description}</h3>
              ) : desc ? (
                <h3 className="subtitle">{desc}</h3>
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
    </>
  );
};

export default Presentation;
