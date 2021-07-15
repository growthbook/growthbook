import React, { ReactElement } from "react";
//import styles from "./Presentation.module.scss";
import {
  Deck,
  Slide,
  Heading,
  FlexBox,
  Box,
  Progress,
  FullScreen,
} from "spectacle";
import { PresentationInterface } from "back-end/types/presentation";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { date } from "../services/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { LearningInterface } from "back-end/types/insight";
import CompactResults from "./Experiment/CompactResults";

type props = {
  presentation: PresentationInterface;
  experiments: {
    experiment: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
  }[];
  //learnings: LearningInterface[];
};

const Presentation = ({
  presentation,
  experiments,
}: //learnings,
props): ReactElement => {
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

  // get the learnings indexed by the experiment id
  // const lm = new Map();
  // learnings.forEach((l) => {
  //   l.evidence.forEach((obj) => {
  //     if (lm.has(obj.experimentId)) {
  //       const tmp = lm.get(obj.experimentId);
  //       tmp.push(l);
  //       lm.set(obj.experimentId, tmp);
  //     } else {
  //       lm.set(obj.experimentId, [l]);
  //     }
  //   });
  // });

  const expSlides = [];
  presentation.experimentIds.forEach((eid) => {
    // get the results in the right shape:
    const e = em.get(eid);
    expSlides.push(
      <Slide key={expSlides.length}>
        <div className="container-fluid">
          <Heading>{e.experiment.name}</Heading>
          <h4
            className="text-center mb-4 p-2 border"
            style={{ marginTop: -30 }}
          >
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
                  className="expimage"
                  src={v.screenshots[0] && v.screenshots[0].path}
                />
              </div>
            ))}
          </div>
        </div>
      </Slide>
    );
    if (e.snapshot) {
      // const variationNames = e.experiment.variations.map((v) => v.name);
      // const numMetrics = e.experiment.metrics.length;
      expSlides.push(
        <Slide>
          <Heading>Results</Heading>
          <div
            style={{
              overflowY: "auto",
              background: "#fff",
              maxHeight: "100%",
              padding: "0 0",
              color: "#444",
              fontSize: "80%",
            }}
          >
            <CompactResults snapshot={e.snapshot} experiment={e.experiment} />
          </div>
        </Slide>
      );
      // e.experiment.metrics.forEach((metric, i) => {
      //   expSlides.push(
      //     <Slide key={expSlides.length}>
      //       <Heading>Results</Heading>
      //       {numMetrics > 1 && (
      //         <p>
      //           Metric {i + 1} of {numMetrics}
      //         </p>
      //       )}
      // <div
      //   style={{
      //     overflowY: "auto",
      //     background: "#fff",
      //     maxHeight: "100%",
      //     padding: "0 20px",
      //     color: "#444",
      //     fontSize: "80%",
      //   }}
      // >
      //         {/* <MetricResults
      //           metric={metric}
      //           variationNames={variationNames}
      //           snapshot={e.snapshot}
      //         /> */}
      //       </div>
      //     </Slide>
      //   );
      //});
    }

    // if we have a learning from this experiment, add a learning slide
    // if (lm.has(eid)) {
    //   const learnings: LearningInterface[] = lm.get(eid);

    //   expSlides.push(
    //     <Slide key={expSlides.length}>
    //       <Heading>Insight</Heading>
    //       {learnings.map((learning: LearningInterface) => (
    //         <h4 key={`${eid}${learning.id}`} className="mb-5 text-center">
    //           {learning.text}
    //         </h4>
    //       ))}
    //     </Slide>
    //   );
    // }
  });

  const gbTheme = {
    colors: {
      primary: "#fff", // non heading text
      secondary: "#fff", // heading text
      tertiary: "#2c9ad1", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
    },
  };

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

  return (
    <>
      <Deck theme={gbTheme} template={template}>
        <Slide>
          <FlexBox height="100%" className="flexwrap">
            <Heading>
              {presentation.title ? presentation.title : "A/B Tests Review"}
              <h4 className="subtitle">{date(presentation.dateCreated)}</h4>
            </Heading>
          </FlexBox>
        </Slide>
        {expSlides}
      </Deck>
    </>
  );
};

export default Presentation;
