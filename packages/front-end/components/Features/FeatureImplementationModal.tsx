import { FeatureInterface } from "back-end/types/feature";
import Modal from "../Modal";
import ControlledTabs from "../Tabs/ControlledTabs";
import Tab from "../Tabs/Tab";
import Code, { Language } from "../SyntaxHighlighting/Code";
import { useState } from "react";
import CodeSnippetModal from "./CodeSnippetModal";
import { DocLink, DocSection } from "../DocLink";

export interface Props {
  feature: FeatureInterface;
  first: boolean;
  close: () => void;
}

function rubySymbol(name: string): string {
  return name.match(/[^a-zA-Z0-9_]+/) ? `'${name}'` : `:${name}`;
}

export default function FeatureImplementationModal({
  feature,
  close,
  first = true,
}: Props) {
  const [language, setLanguage] = useState<Language>("javascript");
  const [fullSnippet, setFullSnippet] = useState(false);
  const codeSamples: {
    id: string;
    display: string;
    language: Language;
    boolean: string;
    value: string;
    docSection: DocSection;
  }[] = [
    {
      id: "react",
      display: "React",
      language: "tsx",
      boolean: `import { useFeature, IfFeatureEnabled } from "@growthbook/growthbook-react";

// Option 1: The useFeature hook
function MyComponent() {
  const isEnabled = useFeature(${JSON.stringify(feature.id)}).on;
  return (
    <div>{isEnabled ? "ON" : "OFF"}</div>
  )
}

// Option 2: The <IfFeatureEnabled> component
function MyOtherComponent() {
  return (
    <IfFeatureEnabled feature=${JSON.stringify(feature.id)}>
      The feature is <strong>ON</strong>
    </IfFeatureEnabled>
  )
}`,
      value: `import { useGrowthBook } from "@growthbook/growthbook-react";

function MyComponent() {
  const growthbook = useGrowthBook();
  return (
    <div>{growthbook.getFeatureValue(${JSON.stringify(
      feature.id
    )}, "fallback value")}</div>
  )
}`,
      docSection: "tsx",
    },
    {
      id: "javascript",
      display: "Javascript",
      language: "javascript",
      boolean: `if (growthbook.isOn(${JSON.stringify(feature.id)})) {
  console.log("Feature is enabled!")
} else {
  console.log("fallback")
}`,
      value: `
console.log(growthbook.getFeatureValue(${JSON.stringify(
        feature.id
      )}), "fallback value");`,
      docSection: "javascript",
    },

    {
      id: "go",
      display: "Go",
      language: "go",
      boolean: `if gb.Feature(${JSON.stringify(feature.id)}).On {
  // serve the feature
}`,
      value: `value := gb.Feature(${JSON.stringify(
        feature.id
      )}).GetValueWithDefault("default value")
fmt.Println(value)`,
      docSection: "go",
    },
    {
      id: "ruby",
      display: "Ruby",
      language: "ruby",
      boolean: `if gb.on? ${rubySymbol(feature.id)}
  # Do something
end`,
      value: `value = gb.feature_value(${rubySymbol(
        feature.id
      )}, 'default value')
puts(value)`,
      docSection: "ruby",
    },
    {
      id: "kotlin",
      display: "Kotlin (Android)",
      language: "kotlin",
      boolean: `if (gb.feature(${JSON.stringify(feature.id)}).on) {
  // Feature is enabled!
}`,
      value: `val feature = gb.feature(${JSON.stringify(feature.id)})
println(feature.value)
`,
      docSection: "kotlin",
    },
    {
      id: "php",
      display: "PHP",
      language: "php",
      boolean: `if ($growthbook->isOn(${JSON.stringify(feature.id)})) {
  echo "It's on!";
} else {
  echo "It's off :(";
}`,
      value: `$value = $growthbook->getValue(${JSON.stringify(
        feature.id
      )}, "default value");

echo $value;`,
      docSection: "php",
    },

    {
      id: "python",
      display: "Python",
      language: "python",
      boolean: `if gb.isOn(${JSON.stringify(feature.id)}):
  print("My feature is on!")`,
      value: `color = gb.getFeatureValue(${JSON.stringify(
        feature.id
      )}, "blue")`,
      docSection: "python",
    },

    // ruby: {
    //   python: ``,
    //   boolean: ``,
    //   value: ``,
    //   docSection: "ruby",
    // },
  ];

  const codeType = feature.valueType === "boolean" ? "boolean" : "value";

  if (fullSnippet) {
    return (
      <CodeSnippetModal
        close={close}
        featureId={feature.id}
        defaultLanguage={language}
      />
    );
  }

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      closeCta="Close"
      header="Feature implementation"
    >
      <p>
        {first && <>Congratulations on adding your first feature! </>}
        Here is the example code on how to add it to your project
      </p>
      <div>
        <ControlledTabs
          active={language}
          setActive={(language) => setLanguage(language as Language)}
        >
          {codeSamples.map((o, i) => {
            return (
              <Tab key={i} display={o.display} id={o.id}>
                <p>
                  Read the{" "}
                  <DocLink docSection={o.docSection}>
                    {o.display} SDK docs
                  </DocLink>{" "}
                  or view the{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setFullSnippet(true);
                    }}
                  >
                    full implementation example
                  </a>
                  .
                </p>
                <Code language={o.language} code={o[codeType].trim()} />
              </Tab>
            );
          })}
        </ControlledTabs>
      </div>
    </Modal>
  );
}
