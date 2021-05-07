import { FC } from "react";
import Modal from "../Modal";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { okaidia } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useSegments } from "../../services/SegmentsContext";
import useDatasources from "../../hooks/useDatasources";
import Tabs from "../Tabs/Tabs";
import Tab from "../Tabs/Tab";
import { DomMutation } from "../../types/visualDesigner";

type VariationInfo = {
  key?: string;
  weight?: number;
  data?: {
    [key: string]: unknown;
  };
  dom?: DomMutation[];
  css?: string;
};

type Experiment = {
  key: string;
  anon?: boolean;
  auto?: boolean;
  variations: number | VariationInfo[];
  force?: number;
  coverage?: number;
  targeting?: string[];
  url?: string;
};

const InstructionsModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
}> = ({ experiment, close }) => {
  const {
    implementation = "code",
    trackingKey,
    userIdType,
    variations,
    targetURLRegex,
    targeting,
    segment,
    datasource,
  } = experiment;

  const { getSegmentById } = useSegments();
  const { getById } = useDatasources();

  let hasVariationDetails = false;

  const expDef: Experiment = {
    key: trackingKey,
    variations: 0,
  };
  if (targetURLRegex) {
    expDef.url = targetURLRegex;
  }
  if (userIdType === "anonymous") {
    expDef.anon = true;
  }
  if (targeting || segment) {
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
  }
  if (implementation === "visual") {
    expDef.auto = true;
    hasVariationDetails = true;
    expDef.variations = variations.map((v) => {
      const data: VariationInfo = {};
      if (v.dom?.length) {
        data.dom = v.dom;
      }
      if (v.css) {
        data.css = v.css;
      }
      return data;
    });
  }
  if (datasource) {
    const ds = getById(datasource);
    if (ds?.settings?.experiments?.variationFormat === "key") {
      hasVariationDetails = true;
      expDef.variations = expDef.variations || [];
      variations.forEach((v, i) => {
        expDef.variations[i] = expDef.variations[i] || {};
        expDef.variations[i].key = v.key;
      });
    }
  }

  let experimentData: {
    [key: string]: string[];
  };
  if (implementation === "configuration") {
    try {
      if (experiment.data && experiment.data.length > 2) {
        experimentData = JSON.parse(experiment.data);
      }
    } catch (e) {
      console.error(e.message);
    }
    if (experimentData) {
      hasVariationDetails = true;
      expDef.variations = expDef.variations || [];
      variations.forEach((v, i) => {
        expDef.variations[i] = expDef.variations[i] || {};
        expDef.variations[i].data = {};
        Object.keys(experimentData).forEach((k) => {
          expDef.variations[i].data[k] = experimentData[k][i];
        });
      });
    }
  }

  if (!hasVariationDetails) {
    expDef.variations = experiment.variations.length;
  }

  let code = "";
  if (implementation === "code") {
    const variationNames = experiment.variations.map((v) => v.name);
    code = `const {variation} = user.experiment("${trackingKey}");
${variationNames
  .slice(1)
  .map(
    (name, i) => `
${i === 0 ? "if" : "else if"} (variation === ${i + 1}) {
  console.log("${name}");
}`
  )
  .join("")}
else {
  console.log("${variationNames[0]}");
}
`;
  } else if (implementation === "visual") {
    code = `// User automatically assigned and shown a variation, no other code needed.`;
  } else if (implementation === "configuration") {
    code = experimentData
      ? Object.keys(experimentData)
          .map((k) => {
            const varName = k
              .replace(/[^a-zA-Z0-9]/g, "_")
              .replace(/^[0-9]+/, "")
              .replace(/_{2,}/g, "_")
              .replace(/(^_|_$)/g, "");
            return `const ${varName} = user.getFeatureFlag("${k}").value || ${experimentData[k][0]};`;
          })
          .join("\n")
      : "// No feature flags defined for experiment yet...";
  }

  return (
    <Modal
      close={close}
      open={true}
      header="Implementation Instructions"
      size="lg"
      closeCta="Close"
    >
      <h4>Javascript Example</h4>
      <Tabs className="mb-3">
        <Tab display="Using API">
          <p>
            Periodically fetch and cache the list of experiments from our API.
            Then...
          </p>
          <SyntaxHighlighter language="javascript" style={okaidia}>
            {`import GrowthBookClient from '@growthbook/growthbook';
// Instantiate the client and user
const client = new GrowthBookClient();
client.experiments.push(...cachedAPIResponse);
const user = client.user({${
              userIdType === "anonymous" ? "anonId" : "id"
            }: "12345"});${userIdType === "user" ? " // User id" : ""}

${code}`}
          </SyntaxHighlighter>
        </Tab>
        <Tab display="Defined Inline">
          <SyntaxHighlighter language="javascript" style={okaidia}>
            {`import GrowthBookClient from '@growthbook/growthbook';
// Instantiate the client and user
const client = new GrowthBookClient();
client.experiments.push(${JSON.stringify(expDef, null, 2)});
const user = client.user({${
              userIdType === "anonymous" ? "anonId" : "id"
            }: "12345"});${userIdType === "user" ? " // User id" : ""}

${code}`}
          </SyntaxHighlighter>
        </Tab>
      </Tabs>
      Full documentation and other languages:{" "}
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
