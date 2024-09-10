import { RadioGroup } from "@radix-ui/themes";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "@back-end/types/sdk-connection";
import { UseFormReturn } from "react-hook-form";
import { useState } from "react";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";

type FormValues = {
  languages: SDKLanguage[];
  sdkVersion: string;
  cipher: boolean;
  environment: string;
};

interface Props {
  connection: SDKConnectionInterface | null;
  form: UseFormReturn<FormValues, unknown>;
}

const InitiateConnectionPage = ({ connection, form }: Props) => {
  const [languageError] = useState("");

  return (
    <div className="mt-5" style={{ padding: "0px 57px" }}>
      <h4>Select your SDK Language</h4>
      <div className="form-group">
        {languageError ? (
          <span className="ml-3 alert px-1 py-0 mb-0 alert-danger">
            {languageError}
          </span>
        ) : null}
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => {
            form.setValue("languages", languages);
            if (languages?.length === 1) {
              form.setValue("sdkVersion", getLatestSDKVersion(languages[0]));
            }
          }}
          limitLanguages={["react", "javascript", "nodejs", "nocode-other"]}
          multiple={form.watch("languages").length > 1}
          includeOther={false}
          skipLabel={form.watch("languages").length <= 1}
          hideShowAllLanguages={false}
        />
      </div>
      <div>
        <h4>
          Which environment do you want to set up first for your app or website?
        </h4>
        <RadioGroup.Root
          value={form.watch("environment")}
          onValueChange={(val) => form.setValue("environment", val)}
          disabled={!!connection}
        >
          <RadioGroup.Item value="production">Production</RadioGroup.Item>
          <RadioGroup.Item value="dev">Dev</RadioGroup.Item>
          <RadioGroup.Item value="staging">Staging</RadioGroup.Item>
        </RadioGroup.Root>
      </div>
    </div>
  );
};

export default InitiateConnectionPage;
