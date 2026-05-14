import { SDKLanguage } from "shared/types/sdk-connection";
import React, { useCallback, useMemo } from "react";
import { Box } from "@radix-ui/themes";
import Code from "@/components/SyntaxHighlighting/Code";
import { DocLink } from "@/components/DocLink";
import EventTrackerSelector from "@/components/SyntaxHighlighting/Snippets/EventTrackerSelector";

export default function InstallationCodeSnippet({
  language,
  apiKey,
  apiHost,
  encryptionKey,
  remoteEvalEnabled,
  eventTracker,
  setEventTracker,
}: {
  language: SDKLanguage;
  apiKey: string;
  apiHost: string;
  encryptionKey?: string;
  remoteEvalEnabled: boolean;
  eventTracker: string;
  setEventTracker: (value: string) => void;
}) {
  const nocodeSnippet =
    eventTracker && eventTracker === "GTM"
      ? `
<script>
(function(s) {
  s=document.createElement('script'); s.async=true;
  s.dataset.apiHost=${JSON.stringify(apiHost)};
  s.dataset.clientKey=${JSON.stringify(apiKey)};${
    encryptionKey
      ? `\n  s.dataset.decryptionKey=${JSON.stringify(encryptionKey)};`
      : ""
  }${remoteEvalEnabled ? `\n  s.dataset.remoteEval="true";` : ""}
  s.src="https://cdn.jsdelivr.net/npm/@growthbook/growthbook/dist/bundles/auto.min.js";
  document.head.appendChild(s);
})();
</script>      
      `.trim()
      : `
<script async
  data-api-host=${JSON.stringify(apiHost)}${eventTracker === "growthbook" ? `\n  data-tracking="growthbook"` : ""}
  data-client-key=${JSON.stringify(apiKey)}${
    encryptionKey
      ? `\n  data-decryption-key=${JSON.stringify(encryptionKey)}`
      : ""
  }${remoteEvalEnabled ? `\n  data-remote-eval="true"` : ""}
  src="https://cdn.jsdelivr.net/npm/@growthbook/growthbook/dist/bundles/auto.min.js"
></script>
            `.trim();

  const clientSideLanguages = useMemo(
    () => [
      "nocode-webflow",
      "nocode-wordpress",
      "nocode-shopify",
      "nocode-other",
    ],
    [],
  );

  const getInstallationCodeSnippet = useCallback(
    (language: SDKLanguage) => {
      if (eventTracker === "GTM" && clientSideLanguages.includes(language)) {
        return (
          <>
            Add the GrowthBook snippet to your Google Tag Manager as a Custom
            HTML tag.{" "}
            <DocLink docSection="gtmSetup">View Documentation</DocLink>
            <Code language="html" code={nocodeSnippet} />
          </>
        );
      }
      if (language === "nocode-shopify") {
        return (
          <>
            Add the GrowthBook snippet right before the closing{" "}
            <code>&lt;/head&gt;</code> tag in your theme&apos;s{" "}
            <code>theme.liquid</code> file.
            <Code language="html" code={nocodeSnippet} />
          </>
        );
      }
      if (language === "nocode-webflow") {
        return (
          <>
            Go into your site&apos;s settings, click on the &quot;Custom
            Code&quot; tab, and paste the following into the{" "}
            <strong>Head code</strong> section.
            <Code language="html" code={nocodeSnippet} />
          </>
        );
      }
      if (language === "nocode-wordpress") {
        return (
          <>
            Insert the following right before the closing{" "}
            <code>&lt;/head&gt;</code> tag in your site&apos;s HTML. We
            recommend using a plugin like WPCode to make this easier.
            <Code language="html" code={nocodeSnippet} />
          </>
        );
      }
      if (language === "nocode-other") {
        return (
          <>
            Insert the following right before the closing{" "}
            <code>&lt;/head&gt;</code> tag in your site&apos;s HTML.
            <Code language="html" code={nocodeSnippet} />
          </>
        );
      }
      if (language === "javascript") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/growthbook
# OR
yarn add @growthbook/growthbook`.trim()}
          />
        );
      }
      if (language === "react") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/growthbook-react
# OR
yarn add @growthbook/growthbook-react`.trim()}
          />
        );
      }
      if (language === "nodejs") {
        return (
          <Code
            language="bash"
            code={`npm install @growthbook/growthbook
# or
yarn add @growthbook/growthbook`}
          />
        );
      }
      if (language === "nextjs") {
        return (
          <Code
            language="bash"
            code={`npm install @flags-sdk/growthbook
# or
yarn add @flags-sdk/growthbook`}
          />
        );
      }
      if (language === "android") {
        return (
          <Code
            language="javascript"
            filename="build.gradle"
            code={`
repositories {
    mavenCentral()
}

dependencies {
    implementation 'io.growthbook.sdk:GrowthBook:1.+'
}`.trim()}
          />
        );
      }
      if (language === "ios") {
        return (
          <>
            <div className="mb-3">
              Cocoapods
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
              Swift Package Manager (SPM)
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
          </>
        );
      }
      if (language === "go") {
        return (
          <Code
            language="sh"
            code="go get github.com/growthbook/growthbook-golang"
          />
        );
      }
      if (language === "ruby") {
        return <Code language="sh" code={`gem install growthbook`} />;
      }
      if (language === "php") {
        return (
          <Code language="sh" code={`composer require growthbook/growthbook`} />
        );
      }
      if (language === "python") {
        return <Code language="sh" code={`pip install growthbook`} />;
      }
      if (language === "java") {
        return (
          <>
            <div className="mb-3">
              Maven
              <Code
                language="xml"
                code={`
<repositories>
  <repository>
    <id>jitpack.io</id>
    <url>https://jitpack.io</url>
  </repository>
</repositories>

<dependency>
  <groupId>com.github.growthbook</groupId>
  <artifactId>growthbook-sdk-java</artifactId>
  <version>0.3.0</version>
</dependency>
`.trim()}
              />
            </div>
            <div className="mb-3">
              Gradle
              <Code
                language="javascript"
                filename="build.gradle"
                code={`
allprojects {
    repositories {
        maven { url 'https://jitpack.io' }
    }
}
dependencies {
    implementation 'com.github.growthbook:growthbook-sdk-java:0.3.0'
}`.trim()}
              />
            </div>
          </>
        );
      }
      if (language === "flutter") {
        return (
          <Code
            language="yml"
            filename="pubspec.yml"
            code="growthbook_sdk_flutter: ^1.0.0"
          />
        );
      }
      if (language === "csharp") {
        return (
          <Code language="sh" code="dotnet add package growthbook-c-sharp" />
        );
      }
      if (language === "elixir") {
        return (
          <Code
            language="elixir"
            filename="mix.exs"
            code={`
def deps do
  [
    {:growthbook, "~> 0.2"}
  ]
end
    `.trim()}
          />
        );
      }
      if (language === "edge-cloudflare") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/edge-cloudflare
# OR
yarn add @growthbook/edge-cloudflare`.trim()}
          />
        );
      }
      if (language === "edge-fastly") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/edge-fastly
# OR
yarn add @growthbook/edge-fastly`.trim()}
          />
        );
      }
      if (language === "edge-lambda") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/edge-lambda
# OR
yarn add @growthbook/edge-lambda`.trim()}
          />
        );
      }
      if (language === "edge-other") {
        return (
          <Code
            language="sh"
            code={`
npm i --save @growthbook/edge-utils
# OR
yarn add @growthbook/edge-utils`.trim()}
          />
        );
      }

      return <em>Depends on your platform</em>;
    },
    [clientSideLanguages, eventTracker, nocodeSnippet],
  );

  return (
    <>
      {clientSideLanguages.includes(language) && (
        <EventTrackerSelector
          eventTracker={eventTracker}
          setEventTracker={setEventTracker}
        />
      )}
      <Box>{getInstallationCodeSnippet(language)}</Box>
    </>
  );
}
