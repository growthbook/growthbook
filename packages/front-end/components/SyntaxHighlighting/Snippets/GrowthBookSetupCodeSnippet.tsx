import { SDKLanguage } from "back-end/types/sdk-connection";
import { paddedVersionString } from "@growthbook/growthbook";
import { FaExternalLinkAlt } from "react-icons/fa";
import React from "react";
import { DocLink } from "@/components/DocLink";
import Code from "@/components/SyntaxHighlighting/Code";
import EventTrackerSelector, {
  pluginSupportedTrackers,
} from "@/components/SyntaxHighlighting/Snippets/EventTrackerSelector";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { getAppOrigin, isCloud } from "@/services/env";

function indentLines(code: string, indent: number | string = 2) {
  const spaces = typeof indent === "string" ? indent : " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

export default function GrowthBookSetupCodeSnippet({
  language,
  version,
  apiKey,
  apiHost,
  encryptionKey,
  remoteEvalEnabled,
  eventTracker = "GA4",
  setEventTracker,
}: {
  language: SDKLanguage;
  version?: string;
  apiKey: string;
  apiHost: string;
  encryptionKey?: string;
  remoteEvalEnabled: boolean;
  eventTracker: string;
  setEventTracker: (value: string) => void;
}) {
  const featuresEndpoint = apiHost + "/api/features/" + apiKey;
  const trackingComment = "TODO: Use your real analytics tracking system";

  if (language.match(/^nocode/)) {
    return (
      <>
        {eventTracker.startsWith("growthbook") ? (
          <div>
            Flag and experiment exposure events are tracked automatically.
            <br />
            <br />
            You will need to implement additional tracking for other events. See
            our guide to{" "}
            <DocLink docSection="managedWarehouseTracking">
              custom event tracking with GrowthBook Managed Warehouse
            </DocLink>
            <br />
            <br />
            <>
              To add generic events like page views:
              <Code
                language="html"
                code={`
<script>
  // Ensure the global variable exists
  window.gbEvents = window.gbEvents || [];

  // Simple (no properties)
  window.gbEvents.push("Page View");
</script>
          `.trim()}
              />
              or for custom events with properties:
              <Code
                language="html"
                code={`
<script>
  // Ensure the global variable exists
  window.gbEvents = window.gbEvents || [];

  window.gbEvents.push({
      eventName: "Purchase",
      properties: {
        amount: "10.00"
        product: product_id,
      }
    });
</script>
          `.trim()}
              />
            </>
          </div>
        ) : eventTracker === "GA4" ? (
          <div>
            Events are tracked to Google Analytics automatically. No
            configuration needed.
          </div>
        ) : eventTracker === "GTM" ? (
          <div>
            Create a custom event trigger in Google Tag Manager to track
            experiment events to GA4. See our guide to{" "}
            <DocLink docSection="gtmCustomTracking">
              custom event tracking with GTM
            </DocLink>
            .
          </div>
        ) : eventTracker === "segment" ? (
          <div>
            Events are tracked in {eventTracker} automatically. No configuration
            needed.
          </div>
        ) : (
          <>
            You will need to add your own experiment tracking callback BEFORE
            the GrowthBook snippet above:
            <Code
              language="html"
              code={`
<script>
window.growthbook_config = window.growthbook_config || {};
window.growthbook_config.trackingCallback = (experiment, result) => {
  ${indentLines(getTrackingCallback(eventTracker).trim(), 2)}
};
</script>
          `.trim()}
            />
          </>
        )}
      </>
    );
  }

  if (language === "javascript") {
    return (
      <>
        <EventTrackerSelector
          eventTracker={eventTracker}
          setEventTracker={setEventTracker}
        />
        Create a GrowthBook instance. Read more about our{" "}
        <DocLink docSection="javascript">Javascript SDK</DocLink>
        <Code
          language="javascript"
          code={getJSCodeSnippet({
            apiHost,
            apiKey,
            encryptionKey,
            remoteEvalEnabled,
            version,
            eventTracker,
            includeInit: true,
          })}
        />
        {eventTracker === "growthbook" && (
          <>
            <br />
            If you want to use GrowthBook for experiments (and metrics), you
            will need to log events you care about. Read more about our{" "}
            <DocLink docSection="managedWarehouseTracking">
              managed warehouse tracking
            </DocLink>
            . Here are some examples:
            <Code
              language="javascript"
              code={`
// Simple (no properties)
gb.logEvent("Page View");

// With custom properties
gb.logEvent("Button Click", {
  button: "Sign Up",
});
              `}
            />
          </>
        )}
      </>
    );
  }
  if (language === "react") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        <EventTrackerSelector
          eventTracker={eventTracker}
          setEventTracker={setEventTracker}
        />
        Create a GrowthBook instance
        <Code
          language="tsx"
          code={getJSCodeSnippet({
            apiHost,
            apiKey,
            encryptionKey,
            remoteEvalEnabled,
            version,
            eventTracker,
            includeInit: false,
          })}
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
        {eventTracker === "growthbook" && (
          <>
            <br />
            <br />
            If you want to use GrowthBook for experiments (and metrics), you
            will need to log events you care about. Read more about our{" "}
            <DocLink docSection="managedWarehouseTracking">
              managed warehouse tracking
            </DocLink>
            . Here are some examples:
            <Code
              language="javascript"
              code={`
// Simple (no properties)
gb.logEvent("Page View");

// With custom properties
gb.logEvent("Button Click", {
  button: "Sign Up",
});
              `}
            />
          </>
        )}
      </>
    );
  }
  if (language === "nodejs") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    const useMultiUser =
      paddedVersionString(version) >= paddedVersionString("1.3.1");

    if (useMultiUser) {
      return (
        <>
          Create and initialize a GrowthBook client
          <Code
            language="javascript"
            code={`
const { GrowthBookClient } = require("@growthbook/growthbook");

const client = new GrowthBookClient({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
    encryptionKey ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},` : ""
  }
  trackingCallback: (experiment, result, userContext) => {
    // ${trackingComment}
    console.log("Viewed Experiment", userContext.attributes.id, {
      experimentId: experiment.key,
      variationId: result.key
    });
  }
});

await client.init({ timeout: 1000 });
          `.trim()}
          />
          Use a middleware to create a GrowthBook instance that is scoped to the
          current user/request. Store this in the request object for use in
          other routes.
          <Code
            language="javascript"
            code={`
app.use((req, res, next) => {
  const userContext = {
    attributes: {
      id: req.user.id
    }
  }
  
  req.growthbook = client.createScopedInstance(userContext);
});
          `.trim()}
          />
        </>
      );
    }

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
    encryptionKey
      ? `
  // Required for Node 18 or earlier
  SubtleCrypto: require("node:crypto").webcrypto.subtle,`
      : ""
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
  if (language === "nextjs") {
    return (
      <>
        Import the default adapter instance, which is configured by your
        environment variables.
        <Code
          containerClassName="mb-4"
          language="typescript"
          code={`
import { growthbookAdapter } from "@flags-sdk/growthbook";
  `.trim()}
        />
        <div className="h4 mt-4 mb-2">Environment variables</div>
        <Table variant="standard" className="w-auto table-sm table-bordered bg-light my-2">
          <TableHeader>
            <TableRow>
              <TableColumnHeader className="px-3 py-2">Environment variable</TableColumnHeader>
              <TableColumnHeader className="px-3 py-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="px-3">
                <code>GROWTHBOOK_CLIENT_KEY</code>
              </TableCell>
              <TableCell className="px-3">
                <ClickToCopy>{apiKey}</ClickToCopy>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="px-3">
                <code>GROWTHBOOK_API_HOST</code>
                {isCloud() && (
                  <span className="text-muted small ml-2">(optional)</span>
                )}
              </TableCell>
              <TableCell className="px-3">
                <ClickToCopy>{apiHost}</ClickToCopy>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="px-3">
                <code>GROWTHBOOK_APP_ORIGIN</code>
                <span className="text-muted small ml-2">(optional)</span>
              </TableCell>
              <TableCell className="px-3">
                <ClickToCopy>{getAppOrigin()}</ClickToCopy>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="px-3" colSpan={2}>
                <span className="uppercase-title">Edge Config</span>
                <span className="text-muted small ml-2">(optional)</span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="px-3">
                <div>
                  <code>GROWTHBOOK_EDGE_CONNECTION_STRING</code>
                  <span className="ml-2">or</span>
                </div>
                <div>
                  <code>EXPERIMENTATION_CONFIG</code>
                </div>
              </TableCell>
              <TableCell className="px-3">
                <span className="text-muted">
                  Edge Config connection string
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="px-3">
                <code>GROWTHBOOK_EDGE_CONFIG_ITEM_KEY</code>
                <span className="text-muted small ml-2">(optional)</span>
              </TableCell>
              <TableCell className="px-3">
                <span className="text-muted">
                  Defaults to your client key if not provided
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div className="h4 mt-4 mb-2">Experiment tracking</div>
        Define a server-side tracking callback. Note: Client-side tracking is
        also available but requires additional setup.
        <Code
          filename="flags.ts"
          language="typescript"
          code={`
import { growthbookAdapter } from '@flags-sdk/growthbook';
import { after } from 'next/server';
 
growthbookAdapter.setTrackingCallback((experiment, result) => {
  // Safely fire and forget async calls (Next.js)
  after(async () => {
    console.log('Viewed Experiment', {
      experimentId: experiment.key,
      variationId: result.key,
    });
  });
});
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
        Create GrowthBook client instance
        <Code
          language="go"
          code={`
package main

import (
	"context"
	"log"
	"fmt"
	"time"
	"encoding/json"
	gb "github.com/growthbook/growthbook-golang"
)

func main() {
	client, err := gb.NewClient(context.TODO(),
		gb.WithClientKey("${apiKey || "MY_SDK_KEY"}"),${
      encryptionKey ? `\n		gb.WithDecryptionKey("${encryptionKey}"),` : ""
    }
		gb.WithApiHost("${apiHost}"),
		gb.WithPollDataSource(30 * time.Second),
		// ${trackingComment}
		gb.WithExperimentCallback(func(ctx context.Context, experiment *gb.Experiment, result *gb.ExperimentResult, extra any) {
			log.Println("Viewed Experiment")
			log.Println("Experiment Id", experiment.Key)
			log.Println("Variation Id", result.VariationId)
		}),
	)

	if err != nil {
		log.Fatal("Client start failed", "error", err)
		return
	}
	defer client.Close()

	if err := client.EnsureLoaded(context.TODO()); err != nil {
		log.Fatal("Client data load failed", "error", err)
		return
	}
}`.trim()}
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

$growthbook->initialize(
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
  if (language === "edge-cloudflare") {
    return (
      <>
        <p>
          Our <strong>Edge app</strong> provides turnkey Visual Editor and URL
          Redirect experimentation on edge without any of the flicker associated
          with front-end experiments. It runs as a smart proxy layer between
          your application and your end users. It also can inject a
          fully-hydrated front-end SDK onto the rendered page, meaning no extra
          network requests needed.
        </p>

        <div className="h4 mt-4 mb-3">
          Step 1: Set up a Cloudflare Workers project
        </div>
        <p>
          See the official Cloudflare Workers{" "}
          <a
            href="https://developers.cloudflare.com/workers/get-started/guide/"
            target="_blank"
            rel="noreferrer"
          >
            Get started guide <FaExternalLinkAlt />
          </a>{" "}
          to set up your project. Or have a look at our{" "}
          <a
            href="https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare/example"
            target="_blank"
            rel="noreferrer"
          >
            example implementation <FaExternalLinkAlt />
          </a>
          .
        </p>

        <div className="h4 mt-4 mb-3">
          Step 2: Implement our Edge App request handler
        </div>
        <p>
          To run the edge app, add our Cloudflare request handler to your
          project:
        </p>
        <Code
          language="javascript"
          code={`
import { handleRequest } from "@growthbook/edge-cloudflare";

export default {
  fetch: async function (request, env, ctx) {
    return await handleRequest(request, env);
  },
};
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 3: Set up environment variables</div>
        <p>
          Edit your <code>wrangler.toml</code> file and, at minimum, add these
          required fields:
        </p>
        <Code
          language="bash"
          filename="wrangler.toml"
          code={`
[vars]
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${
            encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
          }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 4: Set up payload caching</div>
        <p>
          Set up a <strong>Cloudflare KV</strong> store and use a GrowthBook{" "}
          <strong>SDK Webhook</strong> to keep feature and experiment values
          synced between GrowthBook and your Cloudflare Worker. This eliminates
          network requests from your edge to GrowthBook.
        </p>

        <div className="h4 mt-4 mb-3">Further customization</div>
        <ul>
          <li>
            Enable URL Redirect experiments on edge (off by default) by setting{" "}
            <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code>
          </li>
          <li>
            Enable cookie-based sticky bucketing on edge and browser by setting{" "}
            <code>{`ENABLE_STICKY_BUCKETING="true"`}</code>
          </li>
          <li>
            Enable streaming in the browser by setting{" "}
            <code>{`ENABLE_STREAMING="true"`}</code>
          </li>
          <li>
            Add a custom tracking callback for your browser SDK and/or edge
            worker
          </li>
        </ul>
        <p>
          See the{" "}
          <DocLink docSection="cloudflare">Cloudflare Workers docs</DocLink>{" "}
          further instructions.
        </p>
      </>
    );
  }
  if (language === "edge-fastly") {
    return (
      <>
        <p>
          Our <strong>Edge app</strong> provides turnkey Visual Editor and URL
          Redirect experimentation on edge without any of the flicker associated
          with front-end experiments. It runs as a smart proxy layer between
          your application and your end users. It also can inject a
          fully-hydrated front-end SDK onto the rendered page, meaning no extra
          network requests needed.
        </p>

        <div className="h4 mt-4 mb-3">
          Step 1: Set up a Fastly Compute project for TypeScript or JavaScript
        </div>
        <p>
          See the official Fastly Compute{" "}
          <a
            href="https://www.fastly.com/documentation/guides/compute/"
            target="_blank"
            rel="noreferrer"
          >
            Developer guide <FaExternalLinkAlt />
          </a>{" "}
          to set up your project. Or have a look at our{" "}
          <a
            href="https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-fastly/example"
            target="_blank"
            rel="noreferrer"
          >
            example implementation <FaExternalLinkAlt />
          </a>
          .
        </p>

        <div className="h4 mt-4 mb-3">
          Step 2: Implement our Edge App request handler
        </div>
        <p>
          To run the edge app, add our Fastly request handler to your project:
        </p>
        <Code
          language="javascript"
          code={`
/// <reference types="@fastly/js-compute" />
import { ConfigStore } from "fastly:config-store";
import { KVStore } from "fastly:kv-store";
import { gbHandleRequest, getConfigEnvFromStore } from "@growthbook/edge-fastly";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  const envVarsStore = new ConfigStore("env_vars");
  const env = getConfigEnvFromStore(envVarsStore);

  const config = {
    // Name of Fastly backend pointing to your GrowthBook API Endpoint
    apiHostBackend: "api_host",
    
    // Map of proxy origins to named Fastly backends
    backends: { "https://internal.mysite.io": "my_site" },
    
    // Add one or more caching mechanisms (optional):
    gbCacheStore: new KVStore("gb_cache"),
    gbPayloadStore: new KVStore("gb_payload"),
  };

  return await gbHandleRequest(event.request, env, config);
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 3: Set up backends (origins)</div>
        <p>
          Allow your worker to connect to both your origin site and your
          GrowthBook API by setting up backends (origins) for your Compute
          service from the Fastly dashboard.
          <ul>
            <li className="mt-3">
              In Fastly, create a backend called <code>api_host</code> pointing
              to your API Host (<code>{apiHost}</code>).
              <div>
                In your code, pass this string via{" "}
                <code>config.apiHostBackend</code> to your request handler, as
                show in <em>Step 2</em>.
              </div>
            </li>
            <li className="mt-3">
              In Fastly, create one or more backends pointing to your site
              origins.
              <div>
                In your code, create an object mapping your origin URLs to their
                named backends. Pass this object via{" "}
                <code>config.backends</code> to your request handler, as shown
                in <em>Step 2</em>.
              </div>
            </li>
          </ul>
        </p>

        <div className="h4 mt-4 mb-3">Step 4: Set up environment variables</div>
        <p>
          Create a Config store called <code>env_vars</code> from the Fastly
          dashboard and link it to your service. Then, at minimum, add these
          required key/value pairs:
        </p>
        <Code
          language="bash"
          code={`
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${
            encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
          }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 5: Set up payload caching</div>
        <p>
          Set up a <strong>Fastly KV</strong> store and use a GrowthBook{" "}
          <strong>SDK Webhook</strong> to keep feature and experiment values
          synced between GrowthBook and your Fastly worker. This eliminates
          network requests from your edge to GrowthBook.
        </p>

        <div className="h4 mt-4 mb-3">Further customization</div>
        <ul>
          <li>
            Enable URL Redirect experiments on edge (off by default) by setting{" "}
            <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code>
          </li>
          <li>
            Enable cookie-based sticky bucketing on edge and browser by setting{" "}
            <code>{`ENABLE_STICKY_BUCKETING="true"`}</code>
          </li>
          <li>
            Enable streaming in the browser by setting{" "}
            <code>{`ENABLE_STREAMING="true"`}</code>
          </li>
          <li>
            Add a custom tracking callback for your browser SDK and/or edge
            worker
          </li>
        </ul>
        <p>
          See the <DocLink docSection="fastly">Fastly Compute docs</DocLink>{" "}
          further instructions.
        </p>
      </>
    );
  }
  if (language === "edge-lambda") {
    return (
      <>
        <p>
          Our <strong>Edge app</strong> provides turnkey Visual Editor and URL
          Redirect experimentation on edge without any of the flicker associated
          with front-end experiments. It runs as a smart proxy layer between
          your application and your end users. It also can inject a
          fully-hydrated front-end SDK onto the rendered page, meaning no extra
          network requests needed.
        </p>

        <div className="h4 mt-4 mb-3">Step 1: Set up a Lambda@Edge project</div>
        <p>
          See the official AWS{" "}
          <a
            href="https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-how-it-works-tutorial.html"
            target="_blank"
            rel="noreferrer"
          >
            Tutorial: Create a basic Lambda@Edge function <FaExternalLinkAlt />
          </a>{" "}
          to see how to set up an example Lambda@Edge project. Our Edge App will
          differ from the example app, but it is a worthwhile read.
        </p>
        <p>
          Note that our Edge App responds directly to a{" "}
          <code>viewer-request</code> without forwarding to an origin;
          interaction with CloudFront is minimal (Step 2 in the AWS tutorial).
        </p>

        <div className="h4 mt-4 mb-3">
          Step 2: Implement our Edge App request handler
        </div>
        <p>
          To run the edge app, add our base app to request handler to your
          project.
        </p>
        <p>
          Note: Due to Lambda@Edge limitations, you will need to inject your
          environment variables into the handler either directly into your
          codebase or at compile time.
        </p>
        <Code
          language="javascript"
          code={`
import { handleRequest } from "@growthbook/edge-lambda";

export async function handler(event, ctx, callback) {
  // manually build your environment
  const env = buildEnv();
  // specify additional edge endpoint information
  env.host = "www.mysite.io";
  
  handleRequest(event, callback, env);
}

function buildEnv() {
  return {
    PROXY_TARGET: "https://internal.mysite.io",
    GROWTHBOOK_API_HOST: ${JSON.stringify(apiHost)},
    GROWTHBOOK_CLIENT_KEY: ${JSON.stringify(apiKey)},${
      encryptionKey
        ? `\n    GROWTHBOOK_DECRYPTION_KEY: ${JSON.stringify(encryptionKey)},`
        : ""
    }
  };
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Further customization</div>
        <ul>
          <li>
            Set up an edge key-val store such as <strong>DynamoDB</strong> and
            use a GrowthBook <strong>SDK Webhook</strong> to keep feature and
            experiment values synced between GrowthBook and your edge worker.
            This eliminates network requests from your edge to GrowthBook.
          </li>
          <li>
            Enable URL Redirect experiments on edge (off by default) by setting{" "}
            <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code>
          </li>
          <li>
            Enable cookie-based sticky bucketing on edge and browser by setting{" "}
            <code>{`ENABLE_STICKY_BUCKETING="true"`}</code>
          </li>
          <li>
            Enable streaming in the browser by setting{" "}
            <code>{`ENABLE_STREAMING="true"`}</code>
          </li>
          <li>
            Add a custom tracking callback for your browser SDK and/or edge
            worker
          </li>
        </ul>
        <p>
          See the <DocLink docSection="lambda">Lambda@Edge docs</DocLink>{" "}
          further instructions.
        </p>
      </>
    );
  }
  if (language === "edge-other") {
    return (
      <>
        <p>
          Our <strong>Edge app</strong> provides turnkey Visual Editor and URL
          Redirect experimentation on edge without any of the flicker associated
          with front-end experiments. It runs as a smart proxy layer between
          your application and your end users. It also can inject a
          fully-hydrated front-end SDK onto the rendered page, meaning no extra
          network requests needed.
        </p>

        <div className="h4 mt-4 mb-3">
          Step 1: Implement our Edge App request handler
        </div>
        <p>
          To run the edge app, add our base app to request handler to your
          project. You will need to manually build app context and helper
          functions:
        </p>
        <Code
          language="javascript"
          code={`
import { edgeApp, getConfig, defaultContext } from "@growthbook/edge-utils";

export async function handler(request, env) {
  const context = await init(env);
  return edgeApp(context, request);
}

function init(env) {
  const context = defaultContext;
  context.config = getConfig(env);
  context.helpers = {
    // define utility functions for request/response manipulation
  };
  return context;
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 2: Define helper methods</div>
        <p>
          You&apos;ll need to define helper methods that correspond to how your
          edge provider handles various request and response utilities. For
          instance: reading request headers, creating a response object,
          managing cookies, etc.
        </p>

        <div className="h4 mt-4 mb-3">Step 3: Set up environment variables</div>
        <p>
          Add these required fields, at minimum, to your environment variables:
        </p>
        <Code
          language="bash"
          code={`
[vars]
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${
            encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
          }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Further customization</div>
        <ul>
          <li>
            Set up an edge key-val store and use a GrowthBook{" "}
            <strong>SDK Webhook</strong> to keep feature and experiment values
            synced between GrowthBook and your edge worker. This eliminates
            network requests from your edge to GrowthBook.
          </li>
          <li>
            Enable URL Redirect experiments on edge (off by default) by setting{" "}
            <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code>
          </li>
          <li>
            Enable cookie-based sticky bucketing on edge and browser by setting{" "}
            <code>{`ENABLE_STICKY_BUCKETING="true"`}</code>
          </li>
          <li>
            Enable streaming in the browser by setting{" "}
            <code>{`ENABLE_STREAMING="true"`}</code>
          </li>
          <li>
            Add a custom tracking callback for your browser SDK and/or edge
            worker
          </li>
        </ul>
        <p>
          See the <DocLink docSection="edge">Other Edge docs</DocLink> further
          instructions.
        </p>
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

const getTrackingCallback = (eventTracker) => {
  return eventTracker === "GA4" || eventTracker === "GTM"
    ? `
if (window.gtag) {
  window.gtag("event", "experiment_viewed", {
    experiment_id: experiment.key,
    variation_id: result.key,
  });
} else {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: "experiment_viewed",
    experiment_id: experiment.key,
    variation_id: result.key,
  });
}`
    : eventTracker === "segment"
      ? `
analytics.track("Experiment Viewed", {
  experimentId: experiment.key,
  variationId: result.key,
});
`
      : eventTracker === "mixpanel"
        ? `
mixpanel.track("$experiment_started", {
  "Experiment name": experiment.key,
  "Variant name": result.key,
  $source: "growthbook",
});
`
        : eventTracker === "matomo"
          ? `
window["_paq"] = window._paq || [];
window._paq.push([
  "trackEvent",
  "ExperimentViewed",
  experiment.key,
  "v" + result.key,
]);
`
          : eventTracker === "amplitude"
            ? `
amplitude.track('Experiment Viewed', {experimentId: experiment.key, variantId: result.key});
`
            : eventTracker === "rudderstack"
              ? `
rudderanalytics.track("Experiment Viewed", {
  experimentId: experiment.key,
  variationId: result.key,
});
`
              : eventTracker === "snowplow"
                ? `
if (window.snowplow) {
  window.snowplow("trackSelfDescribingEvent", {
    event: {
      schema: "iglu:io.growthbook/experiment_viewed/jsonschema/1-0-0",
      data: {
        experimentId: e.key,
        variationId: r.key,
        hashAttribute: r.hashAttribute,
        hashValue: r.hashValue,
      },
    },
  });
}
`
                : `
// This is where you would send an event to your analytics provider
console.log("Viewed Experiment", {
  experimentId: experiment.key,
  variationId: result.key
});
`;
};

const getJSCodeSnippet = ({
  apiHost,
  apiKey,
  encryptionKey,
  remoteEvalEnabled,
  version,
  eventTracker,
  includeInit = true,
}: {
  apiHost: string;
  apiKey: string;
  encryptionKey?: string;
  remoteEvalEnabled: boolean;
  version?: string;
  eventTracker: string;
  includeInit?: boolean;
}) => {
  const useInit = paddedVersionString(version) >= paddedVersionString("1.0.0");
  const usePlugins =
    paddedVersionString(version) >= paddedVersionString("1.4.0");

  let jsCode = "";

  // use the plugin system for supported trackers:
  if (usePlugins && pluginSupportedTrackers.includes(eventTracker)) {
    const pluginTrackers =
      eventTracker === "GA4" || eventTracker === "GTM"
        ? `["ga4", "gtm"]`
        : `["${eventTracker}"]`;

    if (eventTracker === "growthbook") {
      jsCode = `
import { GrowthBook } from "@growthbook/growthbook";
import {
  autoAttributesPlugin,
  growthbookTrackingPlugin
} from "@growthbook/growthbook/plugins";

const gb = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
    encryptionKey ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},` : ""
  }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  plugins: [
    autoAttributesPlugin(),
    growthbookTrackingPlugin()
  ],
});`;
    } else {
      jsCode = `
import { GrowthBook } from "@growthbook/growthbook";
import { 
  thirdPartyTrackingPlugin,
  autoAttributesPlugin
} from "@growthbook/growthbook/plugins";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
    encryptionKey ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},` : ""
  }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  plugins: [
    autoAttributesPlugin(),
    thirdPartyTrackingPlugin({ trackers: ${pluginTrackers} }),
  ],
});`;
    }
  }
  // Supports plugins, but with a different tracker
  else if (usePlugins) {
    const trackingCallback = getTrackingCallback(eventTracker);
    jsCode = `
import { GrowthBook } from "@growthbook/growthbook";
import { autoAttributesPlugin } from "@growthbook/growthbook/plugins";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
    encryptionKey ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},` : ""
  }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    ${indentLines(trackingCallback.trim(), 4)}
  },
  plugins: [ autoAttributesPlugin() ],
});`;
  }
  // No plugins support
  else {
    const trackingCallback = getTrackingCallback(eventTracker);

    jsCode = `import { GrowthBook } from "@growthbook/growthbook";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
    encryptionKey ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},` : ""
  }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    ${indentLines(trackingCallback.trim(), 4)}
  },
});`;
  }

  if (includeInit) {
    jsCode += `

// Wait for features to be available${
      useInit
        ? `\nawait growthbook.init({ streaming: true });`
        : `\nawait growthbook.loadFeatures();`
    }`;
  }

  return jsCode.trim();
};
