import { FeatureInterface } from "back-end/types/feature";
import { useState } from "react";
import { SDKLanguage } from "back-end/types/sdk-connection";
import Modal from "@front-end/components/Modal";
import { DocLink } from "@front-end/components/DocLink";
import BooleanFeatureCodeSnippet from "@front-end/components/SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import MultivariateFeatureCodeSnippet from "@front-end/components/SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";
import InitialSDKConnectionForm from "./SDKConnections/InitialSDKConnectionForm";

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
  const [language, setLanguage] = useState<SDKLanguage>("javascript");
  const [fullSnippet, setFullSnippet] = useState(false);

  const codeType = feature.valueType === "boolean" ? "boolean" : "multivariate";

  if (fullSnippet) {
    return <InitialSDKConnectionForm close={close} feature={feature} />;
  }

  const data = languageMapping[language];

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      closeCta="Close"
      header="Feature Implementation"
    >
      {first && <p>Congratulations on adding your first feature!</p>}
      <div>
        <SDKLanguageSelector
          value={[language]}
          setValue={([language]) => setLanguage(language)}
          multiple={false}
          includeOther={false}
        />
        <h3 className="mt-4">
          {languageMapping[language]?.label} Usage Instructions
        </h3>
        <p>
          Read the{" "}
          <DocLink docSection={data.docs}>{data.label} SDK docs</DocLink> or
          view a{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setFullSnippet(true);
            }}
          >
            complete implementation example
          </a>
          .
        </p>

        {codeType === "boolean" ? (
          <BooleanFeatureCodeSnippet
            language={language}
            featureId={feature.id}
          />
        ) : (
          <MultivariateFeatureCodeSnippet
            language={language}
            featureId={feature.id}
            valueType={feature.valueType}
          />
        )}
      </div>
    </Modal>
  );
}
