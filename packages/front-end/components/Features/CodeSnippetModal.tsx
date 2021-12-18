import stringify from "json-stringify-pretty-compact";
import { getTrackingCallback, TrackingType } from "../../services/codegen";
import { getApiHost, isCloud } from "../../services/env";
import { useContext, useState } from "react";
import { UserContext } from "../ProtectedPage";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useEffect } from "react";
import { SDKAttributeSchema } from "back-end/types/organization";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import Code from "../Code";

type Language = "tsx" | "javascript";

function indentLines(code: string, indent: number = 2) {
  const spaces = " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

function getExampleAttributes(attributeSchema?: SDKAttributeSchema) {
  if (!attributeSchema) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  (attributeSchema || []).forEach(({ property, datatype }) => {
    const parts = property.split(".");
    const last = parts.pop();
    let current = exampleAttributes;
    for (let i = 0; i < parts.length; i++) {
      current[parts[i]] = current[parts[i]] || {};
      current = current[parts[i]];
    }

    // eslint-disable-next-line
    let value: any = null;
    if (datatype === "boolean") {
      value = true;
    } else if (datatype === "number") {
      value = 123;
    } else if (datatype === "string") {
      value = "foo";
    } else if (datatype === "number[]") {
      value = [1, 2, 3];
    } else if (datatype === "string[]") {
      value = ["foo", "bar"];
    }

    current[last] = value;
  });

  return exampleAttributes;
}

function getFeaturesUrl(apiKey?: string) {
  if (!apiKey) {
    return `/path/to/features.json`;
  }

  return (
    (isCloud() ? "https://cdn.growthbook.io" : getApiHost()) +
    `/api/features/${apiKey}`
  );
}

function getImport(language: Language) {
  if (language === "javascript") {
    return `import { GrowthBook } from "@growthbook/growthbook";`;
  }
  if (language === "tsx") {
    return `import { 
  GrowthBook, 
  GrowthBookProvider 
} from "@growthbook/growthbook-react";
import React, { useEffect } from "react";`;
  }
  return "";
}

function getUsageCode(language: Language, apiKey?: string) {
  const loadFeatures = `
// Load feature definitions (from API, database, etc.)
fetch("${getFeaturesUrl(apiKey)}")
  .then((res) => res.json())
  .then((parsed) => {
    growthbook.setFeatures(parsed);
  });`.trim();

  if (language === "javascript") {
    return loadFeatures;
  }
  if (language === "tsx") {
    return `
export default function MyApp() {
  useEffect(() => {
    ${indentLines(loadFeatures, 4)}
  }, []);

  // Wrap your app in the GrowthBookProvider
  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}`.trim();
  }

  return "";
}

function getDocsUrl(language: Language) {
  let ext = "";
  if (language === "javascript") {
    ext = "/js";
  } else if (language === "tsx") {
    ext = "/react";
  }

  return `https://docs.growthbook.io/lib${ext}`;
}

export default function CodeSnippetModal({
  apiKey,
  close,
}: {
  apiKey?: string;
  close: () => void;
}) {
  const [language, setLanguage] = useState<Language>("javascript");
  const [state, setState] = useState<{
    tracking: TrackingType;
    gaDimension?: string;
  }>({
    tracking: "custom",
    gaDimension: "1",
  });

  const { apiCall } = useAuth();

  const { settings, update } = useContext(UserContext);

  const { datasources } = useDefinitions();
  const exampleAttributes = getExampleAttributes(
    settings?.attributeSchema || []
  );

  useEffect(() => {
    const ds = datasources?.[0];
    if (!ds) return;
    if (ds.type === "mixpanel") {
      setState({
        ...state,
        tracking: "mixpanel",
      });
    } else if (ds.type === "google_analytics") {
      setState({
        ...state,
        tracking: "ga",
        gaDimension: ds.params.customDimension,
      });
    } else {
      setState({
        ...state,
        tracking: "segment",
      });
    }
  }, [datasources?.[0]?.type]);

  const clientCode = `
${getImport(language)}

// Create a GrowthBook context
const growthbook = new GrowthBook({
  // TODO: fill in with real values
  attributes: ${indentLines(stringify(exampleAttributes), 2)},
  trackingCallback: (experiment, result) => {
    ${indentLines(
      getTrackingCallback(
        state.tracking,
        state.gaDimension + "",
        "experiment.key",
        "result.variationId"
      ),
      4
    )}
  }
})

${getUsageCode(language, apiKey)}
`.trim();

  return (
    <Modal
      close={close}
      open={true}
      header="Implementation Instructions"
      submit={async () => {
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              sdkInstructionsViewed: true,
            },
          }),
        });
        await update();
      }}
      cta={"Finish"}
    >
      <p>
        Below is some starter code to integrate GrowthBook into your Javascript
        or React application. Read the docs for full implementation details.
      </p>
      <div className="row align-items-center mb-1">
        <div className="col">
          <Field
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as Language);
            }}
            options={[
              { display: "Javascript", value: "javascript" },
              { display: "React", value: "tsx" },
            ]}
          />
        </div>
        <div className="col-auto">
          <a
            href={getDocsUrl(language)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View the full docs
          </a>
        </div>
      </div>
      <Code language={language} code={clientCode} />
    </Modal>
  );
}
