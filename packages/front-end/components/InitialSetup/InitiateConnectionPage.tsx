import { RadioGroup } from "@radix-ui/themes";
import { SDKLanguage } from "@back-end/types/sdk-connection";
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
  connection: string | null;
  form: UseFormReturn<FormValues, unknown>;
}

const InitiateConnectionPage = ({ connection, form }: Props) => {
  return (
    <div className="mt-5" style={{ padding: "0px 57px" }}>
      <h4>Select your SDK Language</h4>
      <div className="form-group">
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => {
            form.setValue("languages", languages);
          }}
          limitLanguages={["react", "javascript", "nodejs", "nocode-other"]}
          includeOther={false}
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
