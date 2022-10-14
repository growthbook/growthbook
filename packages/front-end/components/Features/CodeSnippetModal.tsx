import stringify from "json-stringify-pretty-compact";
import { getTrackingCallback, TrackingType } from "../../services/codegen";
import { getApiHost, isCloud } from "../../services/env";
import { useState, useEffect, ReactElement } from "react";
import useUser from "../../hooks/useUser";
import { useDefinitions } from "../../services/DefinitionsContext";
import { SDKAttributeSchema } from "back-end/types/organization";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import Code, { Language } from "../SyntaxHighlighting/Code";
import ControlledTabs from "../Tabs/ControlledTabs";
import Tab from "../Tabs/Tab";
import { useAttributeSchema } from "../../services/features";
import usePermissions from "../../hooks/usePermissions";
import { DocLink } from "../DocLink";
import SDKEndpointSelector from "./SDKEndpointSelector";

function phpArrayFormat(json: unknown) {
  return stringify(json)
    .replace(/\{/g, "[")
    .replace(/\}/g, "]")
    .replace(/:/g, " =>");
}

function swiftArrayFormat(json: unknown) {
  return stringify(json).replace(/\{/, "[").replace(/\}/g, "]");
}

function indentLines(code: string, indent: number | string = 2) {
  const spaces = typeof indent === "string" ? indent : " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

function rubySymbol(name: string): string {
  return name.match(/[^a-zA-Z0-9_]+/) ? `'${name}'` : `:${name}`;
}

function getExampleAttributes(attributeSchema?: SDKAttributeSchema) {
  if (!attributeSchema?.length) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  attributeSchema.forEach(({ property, datatype, enum: enumList }) => {
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
    } else if (datatype === "enum") {
      value = enumList.split(",").map((v) => v.trim())[0] ?? null;
    }

    current[last] = value;
  });

  return exampleAttributes;
}

function getApiBaseUrl(): string {
  if (isCloud()) {
    return `https://cdn.growthbook.io/`;
  }
  return getApiHost() + "/";
}

export function getSDKEndpoint(apiKey: string, project?: string) {
  let endpoint = getApiBaseUrl() + `api/features/${apiKey || "MY_SDK_KEY"}`;
  if (project) {
    endpoint += `?project=${project}`;
  }
  return endpoint;
}

export default function CodeSnippetModal({
  close,
  featureId = "my-feature",
  defaultLanguage = "javascript",
  inline,
  cta = "Finish",
  submit,
  secondaryCTA,
}: {
  close?: () => void;
  featureId?: string;
  defaultLanguage?: Language;
  inline?: boolean;
  cta?: string;
  submit?: () => Promise<void>;
  secondaryCTA?: ReactElement;
}) {
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const permissions = usePermissions();
  const [state, setState] = useState<{
    tracking: TrackingType;
    gaDimension?: string;
  }>({
    tracking: "custom",
    gaDimension: "1",
  });
  const [apiKey, setApiKey] = useState("");

  const { apiCall } = useAuth();

  const { settings, update } = useUser();

  const attributeSchema = useAttributeSchema();

  const { datasources, project } = useDefinitions();
  const exampleAttributes = getExampleAttributes(attributeSchema);

  const [currentProject, setCurrentProject] = useState(project);

  // Record the fact that the SDK instructions have been seen
  useEffect(() => {
    if (!settings) return;
    if (settings.sdkInstructionsViewed) return;
    if (!permissions.organizationSettings) return;
    (async () => {
      await apiCall(`/organization`, {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            sdkInstructionsViewed: true,
          },
        }),
      });
      await update();
    })();
  }, [settings]);

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
        tracking: "custom",
      });
    }
  }, [datasources?.[0]?.type]);

  return (
    <Modal
      close={close}
      secondaryCTA={secondaryCTA}
      open={true}
      inline={inline}
      size={"lg"}
      header="Implementation Instructions"
      submit={async () => {
        if (submit) await submit();
      }}
      cta={cta}
    >
      <SDKEndpointSelector
        apiKey={apiKey}
        setApiKey={setApiKey}
        project={currentProject}
        setProject={setCurrentProject}
      />
      <p>
        Below is some starter code to integrate GrowthBook into your app. More
        languages coming soon!
      </p>
      <ControlledTabs
        active={language}
        setActive={(language) => setLanguage(language as Language)}
      >
        <Tab display="Javascript" id="javascript">
          <p>
            Read the{" "}
            <DocLink docSection="javascript">full Javascript docs</DocLink> for
            more details.
          </p>
          <Code language="sh" code="npm i --save @growthbook/growthbook" />
          <Code
            language="javascript"
            code={`
import { GrowthBook } from "@growthbook/growthbook";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
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
});

// Load feature definitions from API${
              isCloud()
                ? ""
                : `\n// In production, we recommend putting a CDN in front of the API endpoint`
            }
const FEATURES_ENDPOINT = "${getSDKEndpoint(apiKey, currentProject)}";
fetch(FEATURES_ENDPOINT)
  .then((res) => res.json())
  .then((json) => {
    growthbook.setFeatures(json.features);
  })
  .catch(() => {
    console.log("Failed to fetch feature definitions from GrowthBook");
  });

// TODO: replace with real targeting attributes
growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 2)});

// Use a feature!
if (growthbook.isOn(${JSON.stringify(featureId)})) {
  // ...
}
`.trim()}
          />
        </Tab>
        <Tab display="React" id="tsx">
          <p>
            Read the <DocLink docSection="tsx">full React docs</DocLink> for
            more details.
          </p>
          <Code
            language="sh"
            code="npm i --save @growthbook/growthbook-react"
          />
          <Code
            language="tsx"
            code={`
import { GrowthBook, GrowthBookProvider, useFeature } from "@growthbook/growthbook-react";
import { useEffect } from "react";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
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
});

export default function MyApp() {
  useEffect(() => {
    // Load feature definitions from API${
      isCloud()
        ? ""
        : `\n    // In production, we recommend putting a CDN in front of the API endpoint`
    }
    fetch("${getSDKEndpoint(apiKey, currentProject)}")
      .then((res) => res.json())
      .then((json) => {
        growthbook.setFeatures(json.features);
      });

    // TODO: replace with real targeting attributes
    growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 4)})
  }, [])

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}

// Use a feature!
function MyComponent() {
  const feature = useFeature(${JSON.stringify(featureId)})
  return feature.on ? "New version" : "Old version"
}
            `.trim()}
          />
        </Tab>
        <Tab display="Kotlin (Android)" id="kotlin">
          <p>
            Read the{" "}
            <DocLink docSection="kotlin">
              full Kotlin (Android) SDK docs
            </DocLink>{" "}
            for more details.
          </p>
          <Code
            language="javascript"
            filename="build.gradle"
            code={`repositories {
    mavenCentral()
}

dependencies {
    implementation 'io.growthbook.sdk:GrowthBook:1.+'
}`}
          />
          <Code
            language="kotlin"
            code={`
import com.sdk.growthbook.GBSDKBuilder

// TODO: Real user attributes
val attrs = HashMap<String, Any>()
${Object.keys(exampleAttributes)
  .map((k) => {
    return `attrs.put("${k}", ${JSON.stringify(exampleAttributes[k])})`;
  })
  .join("\n")}

val gb = GBSDKBuilder(
  // Fetch and cache feature definitions from GrowthBook API${
    !isCloud() ? "\n  // We recommend using a CDN in production" : ""
  }
  apiKey = "${apiKey || "MY_SDK_KEY"}${
              currentProject ? "?" + currentProject : ""
            }",
  hostURL = "${getApiBaseUrl()}",
  attributes = attrs,
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // TODO: track in your analytics system
  }
).initialize()

if (gb.feature(${JSON.stringify(featureId)}).on) {
  // Feature is enabled!
}
            `.trim()}
          />
        </Tab>
        <Tab display="Swift (iOS)" id="swift">
          <p>
            View the{" "}
            <a
              href="https://github.com/growthbook/growthbook-swift"
              target="_blank"
              rel="noreferrer"
            >
              GitHub repo
            </a>{" "}
            for more details.
          </p>
          <div className="mb-3">
            <strong>Cocoapods Installation</strong>
            <Code
              language="javascript"
              filename="Podfile"
              code={`
source 'https://github.com/CocoaPods/Specs.git'

target 'MyApp' do
  pod 'GrowthBook-IOS'
end
          `.trim()}
            />
            <Code language="sh" code={"pod install"} />
          </div>
          <div className="mb-3">
            <strong>Swift Package Manager (SPM) Installation</strong>
            <Code
              language="swift"
              filename="Package.swift"
              code={`
dependencies: [
  .package(url: "https://github.com/growthbook/growthbook-swift.git")
]
            `.trim()}
            />
          </div>
          <strong>Usage Instructions</strong>
          <Code
            language="swift"
            code={`
// TODO: Real user attributes
var attrs = ${swiftArrayFormat(exampleAttributes)}

// Fetch and cache feature definitions from GrowthBook API${
              !isCloud() ? "\n// We recommend using a CDN in production" : ""
            }
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${getSDKEndpoint(apiKey, currentProject)}",
  attributes: attrs,
  trackingCallback: { experiment, experimentResult in 
    // TODO: track in your analytics system
  }
).initializer()

if (gb.isOn(${JSON.stringify(featureId)})) {
  // Feature is enabled!
}
          `.trim()}
          />
        </Tab>
        <Tab display="Go" id="go">
          <p>
            Read the <DocLink docSection="go">full Golang SDK docs</DocLink> for
            more details.
          </p>
          <Code
            language="sh"
            code="go get github.com/growthbook/growthbook-golang"
          />
          <Code
            language="go"
            code={`
package main

import (
	"encoding/json"
	"fmt"
	growthbook "github.com/growthbook/growthbook-golang"
	"io"
	"log"
	"net/http"
)

// Features API response
type GrowthBookApiResp struct {
	Features json.RawMessage
	Status   int
}

func GetFeatureMap() []byte {
	// Fetch features JSON from api
	// In production, we recommend adding a db or cache layer
	resp, err := http.Get("${getSDKEndpoint(apiKey, currentProject)}")
	if err != nil {
		log.Println(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	// Just return the features map from the API response
	apiResp := &GrowthBookApiResp{}
	_ = json.Unmarshal(body, apiResp)
	return apiResp.Features
}

func main() {
	featureMap := GetFeatureMap()
	features := growthbook.ParseFeatureMap(featureMap)

	context := growthbook.NewContext().
		WithFeatures(features).
		// TODO: Real user attributes
		WithAttributes(growthbook.Attributes${indentLines(
      JSON.stringify(exampleAttributes, null, "\t"),
      "\t\t"
    )
      .replace(/null/g, "nil")
      .replace(/\n(\t+)\}/, ",\n$1}")}).
		// TODO: Track in your analytics system
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println("Experiment:", experiment.Key, "Variation:", result.VariationID)
		})
	gb := growthbook.New(context)

	// Use a feature!
	if gb.Feature(${JSON.stringify(featureId)}).On {
		// ...
	}
}
            `.trim()}
          />
        </Tab>
        <Tab display="Ruby" id="ruby">
          <p>
            Read the <DocLink docSection="ruby">full Ruby SDK docs</DocLink> for
            more details.
          </p>
          <Code language="sh" code={`gem install growthbook`} />
          <Code
            language="ruby"
            code={`
require 'growthbook'
require 'uri'
require 'net/http'
require 'json'

# Fetch features from GrowthBook API
# TODO: In production, we recommend adding a caching layer (Redis, etc.)
uri = URI('${getSDKEndpoint(apiKey, currentProject)}')
res = Net::HTTP.get_response(uri)
features = res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body)['features'] : nil

# Tracking callback when users are put into an experiment
class MyImpressionListener
  def on_experiment_viewed(experiment, result)
    puts "Assigned variation #{result.variation_id} in experiment #{experiment.key}"
  end
end

# Create a context for the current user/request
gb = Growthbook::Context.new(
  features: features,
  # TODO: Real user attributes for targeting
  attributes: ${indentLines(stringify(exampleAttributes), 4).replace(
    /: null/g,
    ": nil"
  )},
  listener: MyImpressionListener.new
)

if gb.on? ${rubySymbol(featureId)}
  puts 'My feature is on!'
end
            `.trim()}
          />
        </Tab>
        <Tab display="PHP" id="php">
          <p>
            Read the <DocLink docSection="php">full PHP SDK docs</DocLink> for
            more details.
          </p>
          <Code language="sh" code={`composer require growthbook/growthbook`} />
          <Code
            language="php"
            code={`
use Growthbook\\Growthbook;

// TODO: Real user attributes
$attributes = ${phpArrayFormat(exampleAttributes)};

// Fetch feature definitions from GrowthBook API
// In production, we recommend adding a db or cache layer
const FEATURES_ENDPOINT = '${getSDKEndpoint(apiKey, currentProject)}';
$apiResponse = json_decode(file_get_contents(FEATURES_ENDPOINT), true);
$features = $apiResponse["features"];

// Create a GrowthBook instance
$growthbook = Growthbook::create()
  ->withAttributes($attributes)
  ->withFeatures($features)
  ->withTrackingCallback(function ($experiment, $result) {
    // TODO: track in your analytics system
  });

if ($growthbook->isOn(${JSON.stringify(featureId)})) {
  // Feature is enabled!
}
            `.trim()}
          />
        </Tab>
        <Tab display="Python" id="python">
          <p>
            Read the <DocLink docSection="python">full Python SDK docs</DocLink>{" "}
            for more details.
          </p>
          <Code language="sh" code={`pip install growthbook`} />
          <Code
            language="python"
            code={`
import requests
from growthbook import GrowthBook

# Fetch feature definitions from GrowthBook API
# In production, we recommend adding a db or cache layer
apiResp = requests.get("${getSDKEndpoint(apiKey, currentProject)}")
features = apiResp.json()["features"]

# TODO: Real user attributes
attributes = ${stringify(exampleAttributes)
              .replace(/: true/g, ": True")
              .replace(/: false/g, ": False")
              .replace(/: null/g, ": None")}

# Tracking callback when someone is put in an experiment
def on_experiment_viewed(experiment, result):
  # Use whatever event tracking system you want
  print({
    'experimentId': experiment.key,
    'variationId': result.variationId
  })

# Create a GrowthBook instance
gb = GrowthBook(
  attributes = attributes,
  features = features,
  trackingCallback = on_experiment_viewed
)

# Use a feature
if gb.isOn(${JSON.stringify(featureId)}):
  print("Feature is enabled!")
            `.trim()}
          />
        </Tab>
      </ControlledTabs>
    </Modal>
  );
}
