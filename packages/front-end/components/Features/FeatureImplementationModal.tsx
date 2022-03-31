import { FeatureInterface } from "back-end/types/feature";
import Modal from "../Modal";
import ControlledTabs from "../Tabs/ControlledTabs";
import Tab from "../Tabs/Tab";
import Code from "../Code";
import { useState } from "react";
import { Language } from "../Code";
import CodeSnippetModal from "./CodeSnippetModal";

export interface Props {
  feature: FeatureInterface;
  first: boolean;
  close: () => void;
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
    docs: string;
  }[] = [
    {
      id: "react",
      display: "React",
      language: "tsx",
      boolean: `import { useFeature, IfFeatureEnabled } from "@growthbook/growthbook-react";

//...

<IfFeatureEnabled feature=${JSON.stringify(feature.id)}>
  <p>Welcome to our site!</p>
</IfFeatureEnabled>

// or 
const myFeature = useFeature(${JSON.stringify(feature.id)}).on;
if (myFeature) { ...
}
`,
      value: `
console.log(growthbook.getFeatureValue(${JSON.stringify(
        feature.id
      )}), "fallback value");`,
      docs: "https://docs.growthbook.io/lib/react",
    },

    {
      id: "typescript",
      display: "Typescript",
      language: "tsx",
      boolean: `if (growthbook.isOn(${JSON.stringify(feature.id)})) {
  console.log("Feature is enabled!")
} else {
  console.log("fallback")
}`,
      value: `
console.log(growthbook.getFeatureValue(${JSON.stringify(
        feature.id
      )}), "fallback value");`,
      docs: "https://docs.growthbook.io/lib/js",
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
      docs: "https://docs.growthbook.io/lib/js",
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
      docs: "https://docs.growthbook.io/lib/go",
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
      docs: "https://docs.growthbook.io/lib/kotlin",
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
      docs: "https://docs.growthbook.io/lib/php",
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
      docs: "https://docs.growthbook.io/lib/python",
    },

    // ruby: {
    //   python: ``,
    //   boolean: ``,
    //   value: ``,
    //   docs: "https://docs.growthbook.io/lib/ruby",
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
                  <a href={o.docs} target="_blank" rel="noopener noreferrer">
                    {o.display} SDK docs
                  </a>{" "}
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
