import { FC, useState } from "react";
import Modal from "../Modal";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Tabs from "../Tabs/Tabs";
import Tab from "../Tabs/Tab";
import { getEvenSplit } from "../../services/utils";
import stringify from "json-stringify-pretty-compact";
import useForm from "../../hooks/useForm";
import { useEffect } from "react";
import {
  generateJavascriptSnippet,
  getUrlRegex,
  TrackingType,
} from "../../services/codegen";
import TextareaAutosize from "react-textarea-autosize";
import { FaExclamationTriangle } from "react-icons/fa";
import Code from "../Code";

type Experiment = {
  key: string;
  // eslint-disable-next-line
  variations: any[];
  weights?: number[];
  status?: string;
  coverage?: number;
  url?: string;
  groups?: string[];
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
function withHashAttribute(expDef: Experiment) {
  const { anon, ...otherProps } = expDef;

  if (anon) {
    return {
      ...otherProps,
      hashAttribute: "anonId",
    };
  } else {
    return {
      ...otherProps,
    };
  }
}
function withRealRegex(stringified: string): string {
  return stringified.replace(/("url"\s*:\s*)"([^"]+)"/, (match, key, value) => {
    return key + getUrlRegex(value);
  });
}
function toPythonParams(stringified: string): string {
  return stringified
    .replace(/^\{|\}$/g, "")
    .replace(/\n {2}"([a-zA-Z0-9_]+)": /g, "\n  $1 = ");
}
function toRubyParams(stringified: string): string {
  return stringified
    .replace(/^\[|\]$/g, "")
    .replace(/"([a-zA-Z]+)" => /g, ":$1 => ");
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
    status,
    results,
    winner,
    phases,
  } = experiment;

  const phase = phases?.[0];

  const [value, inputProps] = useForm<{
    tracking: TrackingType;
    funcs: string[];
    gaDimension: number;
    mixpanelProjectId: string;
  }>({
    tracking: "segment",
    funcs: variations.slice(1).map((v) => `console.log("${v.name}")`),
    gaDimension: 1,
    mixpanelProjectId: "",
  });
  const [codegen, setCodegen] = useState("");
  useEffect(() => {
    setCodegen(
      generateJavascriptSnippet(
        experiment,
        ["", ...value.funcs],
        value.tracking,
        value.tracking === "ga"
          ? String(value.gaDimension)
          : value.tracking === "mixpanel"
          ? value.mixpanelProjectId
          : ""
      )
    );
  }, [value]);

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

  expDef.groups = [];

  if (phase) {
    if (phase.groups?.length > 0) {
      expDef.groups.push(...phase.groups);
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

  if (!expDef.groups.length) {
    delete expDef.groups;
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
        <Tab display="JS">
          <p>
            Install our{" "}
            <a
              href="https://github.com/growthbook/growthbook-js"
              target="_blank"
              rel="noopener noreferrer"
            >
              Javascript Client Library
            </a>{" "}
            and then...
          </p>
          <Code
            language="javascript"
            code={`const { value } = growthbook.run(${withRealRegex(
              stringify(withHashAttribute(expDef))
            )})\n\nconsole.log(value${
              !variationParam
                ? ""
                : variationParam.match(/^[a-zA-Z0-9_]*$/)
                ? "." + variationParam
                : '["' + variationParam + '"]'
            }); // ${variationParamList}`}
          />
        </Tab>
        <Tab display="React">
          <p>
            Install our{" "}
            <a
              href="https://github.com/growthbook/growthbook-react"
              target="_blank"
              rel="noopener noreferrer"
            >
              React Client Library
            </a>{" "}
            and then...
          </p>
          <Code
            language="tsx"
            code={`function MyComponent() {\n  const { value } = useExperiment(${indentLines(
              stringify(expDef)
            )})\n\n  return <div>{value${
              !variationParam
                ? ""
                : variationParam.match(/^[a-zA-Z0-9_]*$/)
                ? "." + variationParam
                : '["' + variationParam + '"]'
            }}</div>; // ${variationParamList}\n}`}
          />
        </Tab>
        <Tab display="PHP">
          <p>
            Install our{" "}
            <a
              href="https://github.com/growthbook/growthbook-php"
              target="_blank"
              rel="noopener noreferrer"
            >
              PHP Client Library
            </a>{" "}
            and then...
          </p>
          <Code
            language="php"
            code={`<?php\n$experiment = new Growthbook\\Experiment(\n  "${
              expDef.key
            }",\n  ${indentLines(phpArrayFormat(expDef.variations))}${
              removeKeyAndVariations(expDef)
                ? ",\n  " +
                  indentLines(phpArrayFormat(removeKeyAndVariations(expDef)))
                : ""
            }\n);\n$result = $user->experiment($experiment);\n\necho $result->value${
              !variationParam ? "" : '["' + variationParam + '"]'
            }; // ${variationParamList}`}
          />
        </Tab>
        <Tab display="Python">
          <p>
            Install our{" "}
            <a
              href="https://github.com/growthbook/growthbook-python"
              target="_blank"
              rel="noopener noreferrer"
            >
              Python Client Library
            </a>{" "}
            and then...
          </p>
          <Code
            language="python"
            code={`from growthbook import Experiment\n\nresult = gb.run(Experiment(${toPythonParams(
              stringify(withHashAttribute(expDef))
            )}))\n\n# ${variationParamList}\nprint(result.value${
              !variationParam ? "" : '["' + variationParam + '"]'
            })`}
          />
        </Tab>
        <Tab display="Ruby">
          <p>
            Install our{" "}
            <a
              href="https://github.com/growthbook/growthbook-ruby"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ruby Client Library
            </a>{" "}
            and then...
          </p>
          <Code
            language="ruby"
            code={`exp = Growthbook::Experiment.new("${expDef.key}", ${
              expDef.variations.length
            }${
              removeKeyAndVariations(expDef)
                ? ",\n  " +
                  toRubyParams(
                    indentLines(phpArrayFormat(removeKeyAndVariations(expDef)))
                  ) +
                  "\n"
                : ""
            })\n\nresult = user.experiment(exp)\ncase result.variation\n${experiment.variations
              .map((v, i) => {
                return `when ${i}\n  puts ${JSON.stringify(v.name)}`;
              })
              .join("\n")}\nelse\n  puts "Not in experiment"`}
          />
        </Tab>
        <Tab display="Inline">
          <div className="alert alert-warning">
            <FaExclamationTriangle /> Inline Scripts are a beta feature. Use at
            your own risk and make sure to test!
          </div>
          <p>
            Generate a small inline script tag (~500 bytes) for your experiment
            without any dependencies or network requests.
          </p>
          <hr />
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="row">
              <div className="col">
                <div className="form-group">
                  Event Tracking System
                  <select className="form-control" {...inputProps.tracking}>
                    <option value="segment">Segment</option>
                    <option value="mixpanel">Mixpanel</option>
                    <option value="ga">Google Analytics</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>
              {value.tracking === "ga" && (
                <div className="col">
                  <div className="form-group">
                    GA Custom Dimension
                    <input
                      type="number"
                      className="form-control"
                      {...inputProps.gaDimension}
                      min={1}
                      max={100}
                    />
                  </div>
                </div>
              )}
              {value.tracking === "mixpanel" && (
                <div className="col">
                  <div className="form-group">
                    Mixpanel Project Token
                    <input
                      type="text"
                      className="form-control"
                      {...inputProps.mixpanelProjectId}
                    />
                  </div>
                </div>
              )}
            </div>
            {variations.slice(1).map((v, i) => (
              <div className="form-group" key={v.name}>
                <strong>Javascript:</strong> {v.name}
                <TextareaAutosize
                  className="form-control"
                  placeholder={`console.log("${v.name}")`}
                  minRows={1}
                  maxRows={6}
                  {...inputProps.funcs[i]}
                />
                <small className="form-text text-muted">
                  Will be executed if user is assigned variation:{" "}
                  <code>{v.name}</code>
                </small>
              </div>
            ))}
          </form>
          <Code language="html" code={codegen} />
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
