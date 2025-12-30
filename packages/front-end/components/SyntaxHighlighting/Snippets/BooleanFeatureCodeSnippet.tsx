import { SDKLanguage } from "shared/types/sdk-connection";
import Code from "@/components/SyntaxHighlighting/Code";

function rubySymbol(name: string): string {
  return name.match(/[^a-zA-Z0-9_]+/) ? `'${name}'` : `:${name}`;
}

export default function BooleanFeatureCodeSnippet({
  language,
  featureId = "myfeature",
}: {
  language: SDKLanguage;
  featureId?: string;
}) {
  if (language.match(/^nocode/)) {
    return (
      <Code
        language="html"
        code={`
<script>
if (window._growthbook?.isOn(${JSON.stringify(featureId)})) {
  console.log("Feature is enabled!")
}
</script>
        `.trim()}
      />
    );
  }
  if (language === "javascript") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn(${JSON.stringify(featureId)})) {
  console.log("Feature is enabled!")
}
`.trim()}
      />
    );
  }
  if (language === "react") {
    return (
      <Code
        language="tsx"
        code={`
import { useFeatureIsOn } from "@growthbook/growthbook-react";

function MyComponent() {
  const enabled = useFeatureIsOn(${JSON.stringify(featureId)});
  
  if (enabled) {
    return <div>On!</div>
  } else {
    return <div>Off!</div>
  }
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
app.get("/", (req, res) => {
  if (req.growthbook.isOn(${JSON.stringify(featureId)})) {
    res.send("Feature is enabled!");
  }
  else {
    res.send("Feature is disabled");
  }
});
`.trim()}
      />
    );
  }
  if (language === "nextjs") {
    return (
      <>
        <div className="font-weight-bold text-muted mt-2">
          Define your feature flag
        </div>
        <Code
          filename="flags.ts"
          language="typescript"
          code={`
import { growthbookAdapter } from '@flags-sdk/growthbook';
import { flag } from 'flags/next';
import { identify } from '@/lib/identify';

export const myFeatureFlag = flag<boolean>({
  key: ${JSON.stringify(featureId)},
  adapter: growthbookAdapter.feature<boolean>(),
  defaultValue: false,
  identify,
});
`.trim()}
        />

        <div className="font-weight-bold text-muted mt-2">Use the flag</div>
        <Code
          filename="my-component.tsx"
          language="tsx"
          code={`
import { myFeatureFlag } from '@/flags';

function MyComponent() {
  const enabled = await myFeatureFlag();

  if (enabled) {
    return <div>On!</div>
  } else {
    return <div>Off!</div>
  }
}
  `.trim()}
        />
      </>
    );
  }
  if (language === "android") {
    return (
      <Code
        language="kotlin"
        code={`
if (gb.feature(${JSON.stringify(featureId)}).on) {
  // Feature is enabled!
}
`.trim()}
      />
    );
  }
  if (language === "ios") {
    return (
      <Code
        language="swift"
        code={`
if (gb.isOn(${JSON.stringify(featureId)})) {
  // Feature is enabled!
}
    `.trim()}
      />
    );
  }
  if (language === "go") {
    return (
      <Code
        language="go"
        code={`

result := client.EvalFeature(context.Background(), ${JSON.stringify(featureId)})
if result.On {
  // Feature is enabled!
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
if gb.on? ${rubySymbol(featureId)}
  # Feature is enabled!
end
            `.trim()}
      />
    );
  }
  if (language === "php") {
    return (
      <Code
        language="php"
        code={`
if ($growthbook->isOn(${JSON.stringify(featureId)})) {
  echo "Feature is enabled!";
}
            `.trim()}
      />
    );
  }
  if (language === "python") {
    return (
      <Code
        language="python"
        code={`
if gb.is_on(${JSON.stringify(featureId)}):
  print("Feature is enabled!")
            `.trim()}
      />
    );
  }
  if (language === "java") {
    return (
      <Code
        language="java"
        code={`
if (growthBook.isOn(${JSON.stringify(featureId)})) {
  // Feature is enabled!
}
            `.trim()}
      />
    );
  }
  if (language === "flutter") {
    return (
      <Code
        language="dart"
        code={`
if (gb.feature(${JSON.stringify(featureId)}).on) {
  // Feature is enabled!
}
`.trim()}
      />
    );
  }
  if (language === "csharp") {
    return (
      <Code
        language="csharp"
        code={`
if (gb.IsOn(${JSON.stringify(featureId)})) {
  // Feature is enabled!
}
    `.trim()}
      />
    );
  }
  if (language === "elixir") {
    return (
      <Code
        language="elixir"
        code={`
feature = GrowthBook.feature(context, ${JSON.stringify(featureId)})
if feature.on? do
  IO.puts "Feature is enabled"
end
        `.trim()}
      />
    );
  }
  if (language === "edge-cloudflare") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }
  if (language === "edge-fastly") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }
  if (language === "edge-lambda") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  const resp = { status: "200", body: "<h1>foo</h1>" };
  callback(null, resp);
} else {
  const resp = { status: "200", body: "<h1>bar</h1>" };
  callback(null, resp);
}
        `.trim()}
      />
    );
  }
  if (language === "edge-other") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }

  return <em>Depends on your platform</em>;
}
