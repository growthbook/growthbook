import stringify from "json-stringify-pretty-compact";
import { getTrackingCallback, TrackingType } from "../../services/codegen";
import Code from "../Code";
import { getApiHost, isCloud } from "../../services/env";
import { useContext, useState } from "react";
import { UserContext } from "../ProtectedPage";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useEffect } from "react";

function indentLines(code: string, indent: number = 2) {
  const spaces = " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

export default function CodeSnippet({ apiKey }: { apiKey?: string }) {
  const [state, setState] = useState<{
    tracking: TrackingType;
    gaDimension?: string;
  }>({
    tracking: "custom",
  });

  const { datasources } = useDefinitions();
  const { settings } = useContext(UserContext);

  useEffect(() => {
    const ds = datasources?.[0];
    if (!ds) return;
    if (ds.type === "mixpanel") {
      setState({
        tracking: "mixpanel",
      });
    } else if (ds.type === "google_analytics") {
      setState({
        tracking: "ga",
        gaDimension: ds.params.customDimension,
      });
    } else {
      setState({
        tracking: "segment",
      });
    }
  }, [datasources?.[0]?.type]);

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  (settings?.attributeSchema || []).forEach(({ property, datatype }) => {
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

  const clientCode = `
import { GrowthBook } from '@growthbook/growthbook';

// Create a GrowthBook context
const growthbook = new GrowthBook({
  attributes: ${indentLines(stringify(exampleAttributes), 2)},
  trackingCallback: (experiment, result) => {
    ${indentLines(
      getTrackingCallback(
        state.tracking,
        state.gaDimension + "",
        "experiment.trackingKey",
        "result.variationId"
      ),
      4
    )}
  }
})

// Load feature definitions (from API, database, etc.)
fetch("${
    isCloud() ? "https://cdn.growthbook.io" : getApiHost()
  }/features/${apiKey}.json")
  .then((res) => res.json())
  .then((parsed) => {
    growthbook.setFeatures(parsed);
  });
`.trim();

  return (
    <div>
      <Code language="javascript" code={clientCode} />
      <p>
        <a
          href="https://docs.growthbook.io/lib/js"
          target="_blank"
          rel="noopener noreferrer"
        >
          View the full docs
        </a>
      </p>
    </div>
  );
}
