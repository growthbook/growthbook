import { SDKLanguage } from "back-end/types/sdk-connection";
import { useState } from "react";
import { paddedVersionString } from "@growthbook/growthbook";
import { DocLink } from "@/components/DocLink";
import SelectField from "@/components/Forms/SelectField";
import Code from "@/components/SyntaxHighlighting/Code";

export default function GrowthBookSetupCodeSnippet({
  language,
  version,
  apiKey,
  apiHost,
  encryptionKey,
  remoteEvalEnabled,
}: {
  language: SDKLanguage;
  version?: string;
  apiKey: string;
  apiHost: string;
  encryptionKey?: string;
  remoteEvalEnabled: boolean;
}) {
  const featuresEndpoint = apiHost + "/api/features/" + apiKey;
  const trackingComment = "TODO: Use your real analytics tracking system";

  const [eventTracker, setEventTracker] = useState("GA4");

  if (language.match(/^nocode/)) {
    return (
      <>
        <div className="form-inline mb-3">
          <SelectField
            label="Event Tracking System"
            labelClassName="mr-2"
            options={[
              { label: "Google Analytics 4", value: "GA4" },
              { label: "Segment.io", value: "segment" },
              { label: "Other", value: "other" },
            ]}
            sort={false}
            value={eventTracker}
            onChange={(value) => setEventTracker(value)}
          />
        </div>

        {eventTracker === "other" ? (
          <>
            You will need to add your own custom experiment tracking callback
            BEFORE the GrowthBook snippet above:
            <Code
              language="html"
              code={`
<script>
window.growthbook_config = window.growthbook_config || {};
window.growthbook_config.trackingCallback = (experiment, result) => {
  customEventTracker("Viewed Experiment", {
    experiment_id: experiment.key,
    variation_id: result.key
  })
};
</script>
          `.trim()}
            />
          </>
        ) : (
          <div>
            Events are tracked in {eventTracker} automatically. No configuration
            needed.
          </div>
        )}
      </>
    );
  }

  if (language === "javascript") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="javascript"
          code={`
import { GrowthBook } from "@growthbook/growthbook";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
            encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.key
    });
  }
});

// Wait for features to be available${
            useInit
              ? `\nawait growthbook.init({ streaming: true });`
              : `\nawait growthbook.loadFeatures();`
          }
`.trim()}
        />
      </>
    );
  }
  if (language === "react") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="tsx"
          code={`
import { GrowthBook } from "@growthbook/growthbook-react";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
            encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.key
    });
  }
});
`.trim()}
        />
        Wrap app in a GrowthBookProvider
        <Code
          language="tsx"
          code={`
import { useEffect } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";

export default function MyApp() {
  useEffect(() => {
    // Load features asynchronously when the app renders${
      useInit
        ? `\n    growthbook.init({ streaming: true });`
        : `\n    growthbook.loadFeatures();`
    }
  }, []);

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
`.trim()}
        />
        If you are using <strong>Next.js</strong>,{" "}
        <a
          href="https://github.com/growthbook/examples/tree/main/next-js"
          target="_blank"
          rel="noreferrer"
        >
          check out our sample app on GitHub
        </a>{" "}
        with examples of using GrowthBook with SSR, API routes, static pages,
        and more.
      </>
    );
  }
  if (language === "nodejs") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        Add some polyfills for missing browser APIs
        <Code
          language="javascript"
          code={`
const { setPolyfills } = require("@growthbook/growthbook");
setPolyfills({
  // Required for Node 17 or earlier
  fetch: require("cross-fetch"),${
    encryptionKey &&
    `
  // Required for Node 18 or earlier
  SubtleCrypto: require("node:crypto").webcrypto.subtle,`
  }
  // Optional, can make feature rollouts faster
  EventSource: require("eventsource")
})
        `.trim()}
        />
        Add a middleware before any routes that will use GrowthBook
        <Code
          language="javascript"
          code={`
const { GrowthBook } = require("@growthbook/growthbook");

app.use(function(req, res, next) {
  // Create a GrowthBook Context
  req.growthbook = new GrowthBook({
    apiHost: ${JSON.stringify(apiHost)},
    clientKey: ${JSON.stringify(apiKey)},${
            encryptionKey
              ? `\n    decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }
    trackingCallback: (experiment, result) => {
      // ${trackingComment}
      console.log("Viewed Experiment", {
        experimentId: experiment.key,
        variationId: result.key
      });
    }
  });

  // Clean up at the end of the request
  res.on('close', () => req.growthbook.destroy());

  // Wait for features to load (will be cached in-memory for future requests)${
    useInit
      ? `\n  req.growthbook.init({ timeout: 1000 })`
      : `\n  req.growthbook.loadFeatures({ timeout: 1000 })`
  }
    .then(() => next())
})
`.trim()}
        />
      </>
    );
  }
  if (language === "android") {
    return (
      <>
        Create GrowthBook instance
        <Code
          language="kotlin"
          code={`
import com.sdk.growthbook.GBSDKBuilder

val gb = GBSDKBuilder(
  apiKey = "${apiKey || "MY_SDK_KEY"}",
  hostURL = "${apiHost}/",
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // ${trackingComment}
    println("Viewed Experiment")
    println("Experiment Id: " + gbExperiment.key)
    println("Variation Id: " + gbExperimentResult.variationId)
  }
).initialize()`.trim()}
        />
      </>
    );
  }
  if (language === "ios") {
    return (
      <>
        Create GrowthBook instance
        <Code
          language="swift"
          code={`
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${featuresEndpoint}",${
            encryptionKey ? `\n  encryptionKey: "${encryptionKey}",` : ""
          }
  trackingCallback: { experiment, experimentResult in 
    // ${trackingComment}
    print("Viewed Experiment")
    print("Experiment Id: ", experiment.key)
    print("Variation Id: ", experimentResult.variationId)
  }
).initializer()
    `.trim()}
        />
      </>
    );
  }
  if (language === "go") {
    return (
      <>
        Helper function to load features from the GrowthBook API
        <Code
          language="go"
          code={`
package main

import (
	"encoding/json"
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
            `.trim()}
        />
        Create GrowthBook instance
        <Code
          language="go"
          code={`
package main

import (
	growthbook "github.com/growthbook/growthbook-golang"
	"log"
)

func main() {
	featureMap := GetFeatureMap()
	features := growthbook.ParseFeatureMap(featureMap)

	context := growthbook.NewContext().
		WithFeatures(features).
		// ${trackingComment}
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println("Viewed Experiment")
			log.Println("Experiment Id", experiment.Key)
			log.Println("Variation Id", result.VariationID)
		})
	gb := growthbook.New(context)
}
            `.trim()}
        />
      </>
    );
  }
  if (language === "ruby") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="ruby"
          code={`
require 'growthbook'

# Fetch features from a GrowthBook instance
# You should cache this in Redis or similar in production
features_repository = Growthbook::FeatureRepository.new(
  endpoint: '${featuresEndpoint}'${
            encryptionKey
              ? `,
  decryption_key: '${encryptionKey}'`
              : ""
          }
)
features = features_repository.fetch
            `.trim()}
        />
        Tracking callback when users are put into an experiment
        <Code
          language="ruby"
          code={`
class MyImpressionListener
  def on_experiment_viewed(experiment, result)
    # ${trackingComment}
    puts "Viewed Experiment"
    puts "Experiment Id: #{experiment.key}"
    puts "Variation Id: #{result.variationId}"
  end
end
            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="ruby"
          code={`
# Create a context for the current user/request
gb = Growthbook::Context.new(
  features: features,
  listener: MyImpressionListener.new
)
            `.trim()}
        />
      </>
    );
  }
  if (language === "php") {
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="php"
          code={`
use Growthbook\\Growthbook;

$growthbook = Growthbook::create()
  ->withTrackingCallback(function ($experiment, $result) {
    // ${trackingComment}
    print_r([
      "event" => "Viewed Experiment",
      "properties" => [
        "experimentId" => $experiment->key,
        "variationId" => $result->variationId
      ]
    ]);
  });
            `.trim()}
        />
        Load features from the GrowthBook API
        <Code
          language="php"
          code={`
// Cache features across requests (any psr-16 library will work)
$cache = new \\Cache\\Adapter\\Apcu\\ApcuCachePool();
$growthbook->withCache($cache);

$growthbook->loadFeatures(
  "${apiKey || "MY_SDK_KEY"}", // Client Key
  "${apiHost}"${
            encryptionKey
              ? `, // API Host
  "${encryptionKey}" // Decryption Key`
              : " // API Host"
          }
);
            `.trim()}
        />
      </>
    );
  }
  if (language === "python") {
    return (
      <>
        Callback function when a user is put into an experiment
        <Code
          language="python"
          code={`
def on_experiment_viewed(experiment, result):
  # ${trackingComment}
  print("Viewed Experiment")
  print("Experiment Id: " + experiment.key)
  print("Variation Id: " + result.key)
            `.trim()}
        />
        Create a GrowthBook instance and load features
        <Code
          language="python"
          code={`
from growthbook import GrowthBook

gb = GrowthBook(
  api_host = "${apiHost}",
  client_key = "${apiKey || "MY_SDK_KEY"}",${
            encryptionKey
              ? `
  decryption_key = "${encryptionKey}",`
              : ""
          }
  on_experiment_viewed = on_experiment_viewed
)

gb.load_features()
            `.trim()}
        />
      </>
    );
  }
  if (language === "java") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="java"
          code={`
URI featuresEndpoint = new URI("${featuresEndpoint}");
HttpRequest request = HttpRequest.newBuilder().uri(featuresEndpoint).GET().build();
HttpResponse<String> response = HttpClient.newBuilder().build()
    .send(request, HttpResponse.BodyHandlers.ofString());
String featuresJson = new JSONObject(response.body()).get("features").toString();
            `.trim()}
        />
        Callback when a user is put into an experiment
        <Code
          language="java"
          code={`
TrackingCallback trackingCallback = new TrackingCallback() {
  public <ValueType> void onTrack(
      Experiment<ValueType> experiment,
      ExperimentResult<ValueType> experimentResult
  ) {
    // ${trackingComment}
    System.out.println("Viewed Experiment")
    System.out.println("Experiment Id: " + experiment.key)
    System.out.println("Variation Id: " + experimentResult.variationId)
  }
};

            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="java"
          code={
            encryptionKey
              ? `
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesObj.toString()) // Optional
    .encryptionKey("${encryptionKey}") // You may want to store this in an environment variable
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()
              : `
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesObj.toString()) // Optional
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()
          }
        />
      </>
    );
  }
  if (language === "flutter") {
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="dart"
          code={`
final GrowthBookSDK gb = GBSDKBuilderApp(
  hostURL: '${apiHost}/',
  apiKey: "${apiKey}",
  growthBookTrackingCallBack: (gbExperiment, gbExperimentResult) {
    // ${trackingComment}
    print("Viewed Experiment")
    print("Experiment Id: " + gbExperiment.key)
    print("Variation Id: " + gbExperimentResult.variationId)
  },
).initialize();
`.trim()}
        />
      </>
    );
  }
  if (language === "csharp") {
    return (
      <>
        Get features from the GrowthBook API
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
    `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="csharp"
          code={`
var context = new Context
{
    Enabled = true,
    Features = features
};
var gb = new GrowthBook.GrowthBook(context);
    `.trim()}
        />
      </>
    );
  }
  if (language === "elixir") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="elixir"
          code={`
:inets.start()
:ssl.start()

url = '${featuresEndpoint}'
headers = [{'accept', 'application/json'}]

http_request_opts = [
  ssl: [
    verify: :verify_peer,
    cacerts: :public_key.cacerts_get(),
    customize_hostname_check: [
      match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
    ]
  ]
]

{:ok, {_, _, json}} = :httpc.request(:get, {url, headers}, http_request_opts, [])

%{"status" => 200, "features" => features} = Jason.decode!(json)
features = GrowthBook.Config.features_from_config(features)
          `.trim()}
        />
      </>
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
