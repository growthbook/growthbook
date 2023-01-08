import { SDKLanguage } from "back-end/types/sdk-connection";
import stringify from "json-stringify-pretty-compact";
import { SDKAttributeSchema } from "back-end/types/organization";
import { useAttributeSchema } from "@/services/features";
import { DocLink } from "@/components/DocLink";
import Code from "../Code";

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

export default function GrowthBookSetupCodeSnippet({
  language,
  apiKey,
  apiHost,
  useStreaming = false,
  encryptionKey,
}: {
  language: SDKLanguage;
  apiKey: string;
  apiHost: string;
  useStreaming?: boolean;
  encryptionKey?: string;
}) {
  const featuresEndpoint = apiHost + "api/features/" + apiKey;

  const attributeSchema = useAttributeSchema();
  const exampleAttributes = getExampleAttributes(attributeSchema);

  if (language === "javascript") {
    return (
      <Code
        language="javascript"
        code={`
import { GrowthBook } from "@growthbook/growthbook";

// Create a GrowthBook Context
const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
          useStreaming ? `\n  streaming: true,` : ""
        }${
          encryptionKey
            ? `\n  encryptionKey: ${JSON.stringify(encryptionKey)},`
            : ""
        }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // TODO: use your real analytics tracking system
    analytics.track("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});

// TODO: replace with real targeting attribute values
growthbook.setAttributes(${stringify(exampleAttributes)});
`.trim()}
      />
    );
  }
  if (language === "react") {
    return (
      <Code
        language="tsx"
        code={`
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { useEffect } from "react";

// Create a GrowthBook Context
const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
          useStreaming ? `\n  streaming: true,` : ""
        }${
          encryptionKey
            ? `\n  encryptionKey: ${JSON.stringify(encryptionKey)},`
            : ""
        }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // TODO: use your real analytics tracking system
    analytics.track("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});

// TODO: replace with real targeting attribute values
growthbook.setAttributes(${stringify(exampleAttributes)});

export default function MyApp() {
  return (
    <GrowthBookProvider growthbook={growtbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
`.trim()}
      />
    );
  }
  if (language === "nodejs") {
    return (
      <Code
        language="javascript"
        code={`
const { GrowthBook } = require("@growthbook/growthbook");
const fetch = require("node-fetch");
${encryptionKey ? `const subtleCrypto = require('node:crypto')\n` : ""}
app.use(function(req, res, next) {
  // Create a GrowthBook Context
  req.growthbook = new GrowthBook({
    apiHost: ${JSON.stringify(apiHost)},
    clientKey: ${JSON.stringify(apiKey)},${
          useStreaming ? `\n    streaming: true,` : ""
        }${
          encryptionKey
            ? `\n    encryptionKey: ${JSON.stringify(
                encryptionKey
              )},\n    crypto: subtleCrypto,`
            : ""
        }
    enableDevMode: true,
    fetch: fetch,
    trackingCallback: (experiment, result) => {
      // TODO: use your real analytics tracking system
      analytics.track("Viewed Experiment", {
        experimentId: experiment.key,
        variationId: result.variationId
      });
    },
    // TODO: replace with real targeting attribute values
    attributes: ${indentLines(stringify(exampleAttributes), 4)}
  });

  // Clean up at the end of the request
  res.on('close', () => req.growthbook.destroy());

  // Wait for features to load (will be cached in-memory for future requests)
  req.growthbook.waitForFeatures()
    .then(() => next())
    .catch((e) => {
      console.error("Failed to load features from GrowthBook", e));
      next();
    })
})
`.trim()}
      />
    );
  }
  if (language === "android") {
    return (
      <Code
        language="kotlin"
        code={`
import com.sdk.growthbook.GBSDKBuilder

// TODO: replace with real targeting attribute values
val attrs = HashMap<String, Any>()
${Object.keys(exampleAttributes)
  .map((k) => {
    return `attrs.put("${k}", ${JSON.stringify(exampleAttributes[k])})`;
  })
  .join("\n")}

// Create a GrowthBook Context
val gb = GBSDKBuilder(
  apiKey = "${apiKey || "MY_SDK_KEY"}",
  hostURL = "${apiHost}",
  attributes = attrs,
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // TODO: Use your real analytics tracking system
    analytics.track("Viewed Experiment", buildJsonObject {
      put("experimentId", gbExperiment.key)
      put("variationId" gbExperimentResult.variationId)
  });
  }
).initialize()`.trim()}
      />
    );
  }
  if (language === "ios") {
    return (
      <Code
        language="swift"
        code={`
// TODO: replace with real targeting attribute values
var attrs = ${swiftArrayFormat(exampleAttributes)}

// Create a GrowthBook Context
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${featuresEndpoint}",
  attributes: attrs,
  trackingCallback: { experiment, experimentResult in 
    // TODO: track in your analytics system
    print("Viewed Experiment", experiment.key, experimentResult.variationId)
}
).initializer()
    `.trim()}
      />
    );
  }
  if (language === "go") {
    return (
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
	resp, err := http.Get("${featuresEndpoint}")
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
		// TODO: Real targeting attribute values
		WithAttributes(growthbook.Attributes${indentLines(
      JSON.stringify(exampleAttributes, null, "\t"),
      "\t\t"
    )
      .replace(/null/g, "nil")
      .replace(/\n(\t+)\}/, ",\n$1}")}).
		// TODO: Track in your analytics system
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println("Viewed Experiment", experiment.Key, result.VariationID)
		})
	gb := growthbook.New(context)
}
            `.trim()}
      />
    );
  }
  if (language === "ruby") {
    return (
      <Code
        language="ruby"
        code={`
require 'growthbook'
require 'uri'
require 'net/http'
require 'json'

# Fetch features from GrowthBook API
uri = URI('${featuresEndpoint}')
res = Net::HTTP.get_response(uri)
features = res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body)['features'] : nil

# Tracking callback when users are put into an experiment
class MyImpressionListener
  def on_experiment_viewed(experiment, result)
    # TODO: track in your analytics system
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
            `.trim()}
      />
    );
  }
  if (language === "php") {
    return (
      <Code
        language="php"
        code={`
use Growthbook\\Growthbook;

// TODO: Use real targeting attribute values
$attributes = ${phpArrayFormat(exampleAttributes)};

// Fetch feature definitions from GrowthBook API
const FEATURES_ENDPOINT = '${featuresEndpoint}';
$apiResponse = json_decode(file_get_contents(FEATURES_ENDPOINT), true);
$features = $apiResponse["features"];

// Create a GrowthBook instance
$growthbook = Growthbook::create()
  ->withAttributes($attributes)
  ->withFeatures($features)
  ->withTrackingCallback(function ($experiment, $result) {
    // TODO: track in your analytics system
  });
            `.trim()}
      />
    );
  }
  if (language === "python") {
    return (
      <Code
        language="python"
        code={`
import requests
from growthbook import GrowthBook

# Fetch feature definitions from GrowthBook API
apiResp = requests.get("${featuresEndpoint}")
features = apiResp.json()["features"]

# TODO: Real targeting attribute values
attributes = ${stringify(exampleAttributes)
          .replace(/: true/g, ": True")
          .replace(/: false/g, ": False")
          .replace(/: null/g, ": None")}

def on_experiment_viewed(experiment, result):
  # Use whatever event tracking system you want
  analytics.track('usr_123abc', 'Viewed Experiment', {
    'experimentId': experiment.key,
    'variationId': result.variationId
  })

# Create a GrowthBook instance
gb = GrowthBook(
  attributes = attributes,
  features = features,
  trackingCallback = on_experiment_viewed
)
            `.trim()}
      />
    );
  }
  if (language === "java") {
    return (
      <Code
        language="java"
        code={`
// Fetch feature definitions from GrowthBook API
URI featuresEndpoint = new URI("${featuresEndpoint}");
HttpRequest request = HttpRequest.newBuilder().uri(featuresEndpoint).GET().build();
HttpResponse<String> response = HttpClient.newBuilder().build()
    .send(request, HttpResponse.BodyHandlers.ofString());
String featuresJson = new JSONObject(response.body()).get("features").toString();

// Get user attributes as a JSON string
JSONObject userAttributesObj = new JSONObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `userAttributesObj.put(${JSON.stringify(key)}, ${JSON.stringify(
      value
    )});`;
  })
  .join("\n")}
String userAttributesJson = userAttributesObj.toString();

// Experiment tracking callback
TrackingCallback trackingCallback = new TrackingCallback() {
  public <ValueType> void onTrack(
      Experiment<ValueType> experiment,
      ExperimentResult<ValueType> experimentResult
  ) {
    // TODO: Use your real analytics tracking system
    analytics.enqueue(TrackMessage.builder("Viewed Experiment")
      .userId("usr_abc123")
      .properties(ImmutableMap.builder()
          .put("experimentId", experiment.key)
          .put("variationId", experimentResult.variationId)
          .build()
      )
);
  }
};

// Create a GrowthBook instance
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesJson)
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()}
      />
    );
  }
  if (language === "flutter") {
    return (
      <Code
        language="dart"
        code={`
val attrs = HashMap<String, Any>()
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.put(${JSON.stringify(key)}, ${JSON.stringify(value)})`;
  })
  .join("\n")}

final GrowthBookSDK sdkInstance = GBSDKBuilderApp(
  apiKey: "${apiKey}",
  attributes: {
    attrs
  },
  growthBookTrackingCallBack: (gbExperiment, gbExperimentResult) {
    // TODO: Use your real analytics tracking system
    Analytics.track(
      eventName: 'Viewed Experiment',
      properties: {
        'experimentId': gbExperiment.key,
        'variationId': gbExperimentResult.variationId,
      },
    );
  },
  hostURL: '${apiHost}',
).initialize();
`.trim()}
      />
    );
  }
  if (language === "csharp") {
    return (
      <Code
        language="csharp"
        code={`
using GrowthBook;

// Fetch feature flags from the GrowthBook API
var features = new Dictionary<string, Feature>{};
public class FeaturesResult
{
    public HttpStatusCode Status { get; set; }
    public IDictionary<string, Feature>? Features { get; set; }
    public DateTimeOffset? DateUpdated { get; set; }
}
var url = "${featuresEndpoint}";
var response = await client.GetAsync(url);
if (response.IsSuccessStatusCode)
{
    var content = await response.Content.ReadAsStringAsync();
    var featuresResult = JsonConvert.DeserializeObject<FeaturesResult>(content);
    features = featuresResult.Features;
}

// TODO: real user targeting attribute values
var attrs = new JObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.Add("${JSON.stringify(key)}", ${JSON.stringify(value)});`;
  })
  .join("\n")}

// Create a GrowthBook instance
var context = new Context
{
    Enabled = true,
    Features = features,
    Attributes = attrs
};
var GrowthBook = new GrowthBook.GrowthBook(context);
    `.trim()}
      />
    );
  }

  return (
    <p>
      We don&apos;t have an SDK for your language yet, but we do have extensive
      documentation if you want to build your own and contribute it back to the
      community! <DocLink docSection="buildYourOwn">View Documentation</DocLink>
    </p>
  );
}
