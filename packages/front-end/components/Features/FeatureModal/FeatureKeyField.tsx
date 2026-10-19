import { FC } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import useOrgSettings from "@/hooks/useOrgSettings";

// Short, random key for orgs that keep keys opaque and put the readable name
// in the label, so SDK payloads don't reveal what a Feature Flag is for.
export function generateOpaqueFeatureKey(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "f_" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

const FeatureKeyField: FC<{
  keyField: UseFormRegisterReturn;
  hasLabel?: boolean;
  onGenerateKey?: (key: string) => void;
}> = ({ keyField, hasLabel = false, onGenerateKey }) => (
  <Field
    size="legacy"
    label="Feature Key"
    {...keyField}
    pattern="^[a-zA-Z0-9_.:\|\-]+$"
    placeholder={useOrgSettings().featureKeyExample || "my-feature"}
    required
    title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
    helpText={
      <>
        Only letters, numbers, and the characters <code>_</code>, <code>-</code>
        , <code>.</code>, <code>:</code>, and <code>|</code> allowed. No spaces.{" "}
        <strong>Cannot be changed later!</strong>
        {hasLabel && onGenerateKey ? (
          <>
            {" "}
            The key is sent to SDKs, so with a label it can be opaque and not
            reveal what this Feature Flag is for.{" "}
            <Link onClick={() => onGenerateKey(generateOpaqueFeatureKey())}>
              Generate an opaque key
            </Link>
          </>
        ) : null}
      </>
    }
  />
);

export default FeatureKeyField;
