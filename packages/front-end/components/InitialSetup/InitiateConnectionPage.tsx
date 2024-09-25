import { RadioGroup } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { SdkFormValues } from "@/pages/setup";

interface Props {
  connection: string | null;
  form: UseFormReturn<SdkFormValues, unknown>;
}

const InitiateConnectionPage = ({ connection, form }: Props) => {
  return (
    <div className="mt-5" style={{ padding: "0px 57px" }}>
      <h4>Select your SDK Language</h4>
      <div className="form-group">
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => {
            if (connection) return;
            form.setValue("languages", languages);
          }}
          limitLanguages={["react", "javascript", "nodejs", "nocode-other"]}
          includeOther={false}
          skipLabel
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
          <RadioGroup.Item value="dev">Dev</RadioGroup.Item>
          <RadioGroup.Item value="staging">Staging</RadioGroup.Item>
          <RadioGroup.Item value="production">Production</RadioGroup.Item>
        </RadioGroup.Root>
      </div>
    </div>
  );
};

export default InitiateConnectionPage;
