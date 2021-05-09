import { FC } from "react";
import Modal from "../Modal";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { okaidia } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useSegments } from "../../services/SegmentsContext";
import Tabs from "../Tabs/Tabs";
import Tab from "../Tabs/Tab";
import { getEvenSplit } from "../../services/utils";

type Experiment = {
  key: string;
  variations: string[];
  weights?: number[];
  status?: string;
  coverage?: number;
  url?: string;
  targeting?: string[];
  force?: number;
  anon?: boolean;
};

const InstructionsModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
}> = ({ experiment, close }) => {
  const {
    trackingKey,
    userIdType,
    variations,
    targetURLRegex,
    targeting,
    segment,
    status,
    results,
    winner,
    phases,
  } = experiment;

  const phase = phases?.[0];

  const { getSegmentById } = useSegments();

  const expDef: Experiment = {
    key: trackingKey,
    variations: variations.map((v) => v.key || v.name),
  };
  if (status !== "running") {
    expDef.status = status;
  }
  if (targetURLRegex) {
    expDef.url = targetURLRegex;
  }
  if (userIdType === "anonymous") {
    expDef.anon = true;
  }

  expDef.targeting = [];
  targeting &&
    targeting
      .split("\n")
      .filter(Boolean)
      .forEach((t) => expDef.targeting.push(t));
  if (segment) {
    const seg = getSegmentById(segment);
    if (seg && seg.targeting) {
      seg.targeting
        .split("\n")
        .filter(Boolean)
        .forEach((t) => expDef.targeting.push(t));
    }
  }

  if (phase) {
    if (phase.targeting) {
      phase.targeting
        .split("\n")
        .filter(Boolean)
        .forEach((t) => expDef.targeting.push(t));
    }
    // Add coverage or variation weights if different from defaults
    if (phase.coverage < 1) {
      expDef.coverage = phase.coverage;
    }
    const evenWeights = getEvenSplit(variations.length);
    if (evenWeights.join(",") !== phase.variationWeights.join(",")) {
      expDef.weights = phase.variationWeights;
    }
  }

  if (status === "stopped" && results === "won") {
    expDef.force = winner;
  }

  if (!expDef.targeting.length) {
    delete expDef.targeting;
  }

  return (
    <Modal
      close={close}
      open={true}
      header="Implementation Instructions"
      size="lg"
      closeCta="Close"
    >
      <Tabs className="mb-3">
        <Tab display="Javascript">
          <p>
            Install our{" "}
            <a
              href="https://github.io/growthbook/growthbook-js"
              target="_blank"
              rel="noopener noreferrer"
            >
              Javascript Client Library
            </a>{" "}
            and then...
          </p>
          <SyntaxHighlighter language="javascript" style={okaidia}>
            {`const {variation} = user.experiment(${JSON.stringify(
              expDef,
              null,
              2
            )})
if (variation === "${expDef.variations[0]}") {
  // TODO
} ${expDef.variations
              .slice(1)
              .map(
                (name) => `else if (variation === "${name}") {
  // TODO
} `
              )
              .join("")}
            `}
          </SyntaxHighlighter>
        </Tab>
        <Tab display="React">
          <p>
            Install our{" "}
            <a
              href="https://github.io/growthbook/growthbook-react"
              target="_blank"
              rel="noopener noreferrer"
            >
              React Client Library
            </a>{" "}
            and then...
          </p>
          <SyntaxHighlighter language="javascript" style={okaidia}>
            {`function MyComponent() {
  const {variation} = useExperiment(${JSON.stringify(expDef, null, 2)
    .split("\n")
    .join("\n  ")});

  if (variation === "${expDef.variations[0]}") {
    return <div>...</div>
  } ${expDef.variations
    .slice(1)
    .map(
      (name) => `else if (variation === "${name}") {
    return <div>...</div>
  } `
    )
    .join("")}
}`}
          </SyntaxHighlighter>
        </Tab>
      </Tabs>
      Full documentation and other languages are at{" "}
      <a
        href="https://docs.growthbook.io"
        target="_blank"
        rel="noopener noreferrer"
      >
        https://docs.growthbook.io
      </a>
    </Modal>
  );
};

export default InstructionsModal;
