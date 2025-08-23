import { UseFormReturn } from "react-hook-form";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { SdkFormValues } from "@/pages/setup";
import RadioGroup from "@/ui/RadioGroup";

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
        <RadioGroup
          value={form.watch("environment")}
          setValue={(val) => form.setValue("environment", val)}
          disabled={!!connection}
          options={[
            { value: "dev", label: "Dev" },
            { value: "staging", label: "Staging" },
            { value: "production", label: "Production" },
          ]}
        />
      </div>
    </div>
  );
};

export default InitiateConnectionPage;
