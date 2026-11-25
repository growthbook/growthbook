import { FeatureInterface } from "shared/types/feature";
import { useEffect, useState } from "react";
import { SDKLanguage } from "shared/types/sdk-connection";
import { Trans, useLingui } from "@lingui/react/macro";
import Modal from "@/components/Modal";
import { DocLink } from "@/components/DocLink";
import BooleanFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import MultivariateFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  getConnectionLanguageFilter,
  LanguageFilter,
  languageMapping,
} from "./SDKConnections/SDKLanguageLogo";
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
  const { t } = useLingui();
  const [language, setLanguage] = useState<SDKLanguage>("javascript");
  const [fullSnippet, setFullSnippet] = useState(false);
  const [languageFilter, setLanguageFilter] =
    useState<LanguageFilter>("popular");
  const codeType = feature.valueType === "boolean" ? "boolean" : "multivariate";

  // Default the language to the one used by the first SDK connection in the
  // account (e.g. the language selected during initial setup)
  const { data: sdkConnectionData } = useSDKConnections();
  const [languageInitialized, setLanguageInitialized] = useState(false);
  useEffect(() => {
    if (languageInitialized) return;
    const firstLanguage = sdkConnectionData?.connections.find(
      (c) => !c.archived,
    )?.languages[0];
    if (!firstLanguage) return;
    setLanguage(firstLanguage);
    setLanguageFilter(getConnectionLanguageFilter([firstLanguage]));
    setLanguageInitialized(true);
  }, [sdkConnectionData, languageInitialized]);

  if (fullSnippet) {
    return <InitialSDKConnectionForm close={close} feature={feature} />;
  }

  const data = languageMapping[language];
  const languageLabel = data?.label;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="lg"
      closeCta={t`Close`}
      header={t`Feature Implementation`}
    >
      {first && (
        <p>
          <Trans>Congratulations on adding your first feature!</Trans>
        </p>
      )}
      <div>
        <SDKLanguageSelector
          value={[language]}
          setValue={([language]) => setLanguage(language)}
          multiple={false}
          includeOther={false}
          languageFilter={languageFilter}
          setLanguageFilter={setLanguageFilter}
        />
        <h3 className="mt-4">
          <Trans>{languageLabel} Usage Instructions</Trans>
        </h3>
        <p>
          <Trans>
            Read the{" "}
            <DocLink useRadix={false} docSection={data.docs}>
              {languageLabel} SDK docs
            </DocLink>{" "}
            or view a{" "}
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
          </Trans>
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
