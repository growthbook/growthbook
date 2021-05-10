import { FC } from "react";
import Modal from "../Modal";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow as theme } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useSegments } from "../../services/SegmentsContext";
import Tabs from "../Tabs/Tabs";
import Tab from "../Tabs/Tab";
import { getEvenSplit } from "../../services/utils";
import stringify from "json-stringify-pretty-compact";

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

function removeKeyAndVariations(expDef: Experiment) {
  // eslint-disable-next-line
  const { key, variations, ...other } = expDef;
  if (Object.keys(other).length) return other;
  return null;
}

function phpArrayFormat(json: unknown) {
  return stringify(json)
    .replace(/\{/g, "[")
    .replace(/\}/g, "]")
    .replace(/:/g, " =>");
}

function indentLines(code: string, indent: number = 2) {
  const spaces = " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

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
    variations: variations.map((v) =>
      v.value ? JSON.parse(v.value) : v.key || v.name
    ),
  };

  let variationParam = "";
  let variationParamValues: string[];
  if (typeof expDef.variations[0] === "object") {
    variationParam = Object.keys(expDef.variations[0])[0];
    variationParamValues = expDef.variations.map((v) => v[variationParam]);
  } else {
    variationParamValues = expDef.variations;
  }
  const variationParamList = variationParamValues
    .map((v) => `"${v}"`)
    .join(" or ");

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
          <SyntaxHighlighter language="javascript" style={theme}>
            {`const { value } = user.experiment(${stringify(
              expDef
            )})\n\nconsole.log(value${
              !variationParam
                ? ""
                : variationParam.match(/^[a-zA-Z0-9_]*$/)
                ? "." + variationParam
                : '["' + variationParam + '"]'
            }); // ${variationParamList}`}
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
          <SyntaxHighlighter language="jsx" style={theme}>
            {`function MyComponent() {\n  const { value } = user.experiment(${indentLines(
              stringify(expDef)
            )})\n\n  return <div>{value${
              !variationParam
                ? ""
                : variationParam.match(/^[a-zA-Z0-9_]*$/)
                ? "." + variationParam
                : '["' + variationParam + '"]'
            }}</div>; // ${variationParamList}\n}`}
          </SyntaxHighlighter>
        </Tab>
        <Tab display="PHP">
          <p>
            Install our{" "}
            <a
              href="https://github.io/growthbook/growthbook-php"
              target="_blank"
              rel="noopener noreferrer"
            >
              PHP Client Library
            </a>{" "}
            and then...
          </p>
          <SyntaxHighlighter language="php" style={theme}>
            {`<?php\n$experiment = new Growthbook\\Experiment(\n  "${
              expDef.key
            }",\n  ${indentLines(phpArrayFormat(expDef.variations))}${
              removeKeyAndVariations(expDef)
                ? ",\n  " +
                  indentLines(phpArrayFormat(removeKeyAndVariations(expDef)))
                : ""
            }\n);\n$result = $user->experiment($experiment);\n\necho $result->value${
              !variationParam ? "" : '["' + variationParam + '"]'
            }; // ${variationParamList}`}
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
