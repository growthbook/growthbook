import { FC, ChangeEventHandler, useState } from "react";
import { Box } from "@radix-ui/themes";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import FileInput from "@/ui/FileInput";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import { GBInfo } from "@/components/Icons";
import {
  KEEP_EXISTING_PLACEHOLDER,
  useCanKeepExistingCredentials,
} from "@/components/Forms/secretInput";
import { isCloud } from "@/services/env";

/**
 * Lets the user have GrowthBook create the key pair instead of uploading
 * one. Only the new connect page provides this.
 */
export type KeyPairGenerator = {
  /** The private key in the form is the generated one, so it has no passphrase. */
  usingGenerated: boolean;
  /** Resolves false when the browser cannot generate keys. */
  generate: () => Promise<boolean>;
  /**
   * Key-pair is the only auth method this setup works with (the Event
   * Forwarder's Snowpipe Streaming needs a private key), so password auth
   * is not offered.
   */
  keyPairRequired: boolean;
  /** Set while create mode is generating the initial key, or if that failed. */
  auto?: "pending" | "failed";
};

const SnowflakeForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  onManualParamChange: (name: string, value: string) => void;
  setParams: (params: { [key: string]: string }) => void;
  keyPairGenerator?: KeyPairGenerator;
  /** Event Forwarder uses the Event Destination schema instead. */
  hideSchema?: boolean;
}> = ({
  params,
  existing,
  onParamChange,
  onManualParamChange,
  setParams,
  keyPairGenerator,
  hideSchema = false,
}) => {
  const [useAccessUrl, setUseAccessUrl] = useState(!!params.accessUrl);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [showOwnKey, setShowOwnKey] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Bumped on each successful generate so the file input remounts and drops
  // a previously chosen file name. Keyed on this rather than "is the
  // generated key in use" so uploading a file afterward keeps its name.
  const [generation, setGeneration] = useState(0);
  // Saved connections without authMethod used password; new ones default to key-pair.
  const authMethod = params.authMethod ?? (existing ? "password" : "key-pair");
  const canKeepExistingCredentials = useCanKeepExistingCredentials(
    existing,
    authMethod,
  );
  const usingGeneratedKey = keyPairGenerator?.usingGenerated ?? false;
  const generatingKey =
    !!keyPairGenerator &&
    !existing &&
    keyPairGenerator.auto === "pending" &&
    !showOwnKey;
  const showGeneratedSummary =
    !!keyPairGenerator && !existing && usingGeneratedKey && !showOwnKey;
  const generationFailed =
    generateFailed || keyPairGenerator?.auto === "failed";
  const regenerateKeyPair = async () => {
    if (!keyPairGenerator) return;
    const ok = await keyPairGenerator.generate();
    setGenerateFailed(!ok);
    if (ok) {
      setGeneration((g) => g + 1);
      setShowOwnKey(false);
    }
  };
  // Generating is a no-op the first time, since there is nothing in the form
  // yet. Replacing a key already in use breaks a Snowflake user that already
  // ran the setup SQL, so that case asks first.
  const onRegenerateClick = () => {
    if (usingGeneratedKey) {
      setConfirmRegenerate(true);
    } else {
      void regenerateKeyPair();
    }
  };

  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Account</label>
        <input
          type="text"
          className="form-control"
          name="account"
          required
          placeholder="xy12345.us-east-2.aws"
          value={params.account || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-6">
        <label>Username</label>
        <input
          type="text"
          className="form-control"
          name="username"
          required
          value={params.username || ""}
          onChange={onParamChange}
        />
      </div>

      <div className="form-group col-md-6">
        <label>Authentication Method</label>
        <select
          className="form-control"
          autoComplete="off"
          name="authMethod"
          value={authMethod}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "workload-identity") {
              // Needed on create, which stores params without the server-side merge strip.
              setParams({
                authMethod: value,
                password: "",
                privateKey: "",
                privateKeyPassword: "",
              });
            } else {
              setParams({
                authMethod: value,
                workloadIdentityProvider: "",
              });
            }
          }}
        >
          <option value="key-pair">Key Pair</option>
          {keyPairGenerator?.keyPairRequired ? null : (
            <option value="password">Password</option>
          )}
          {(!isCloud() || authMethod === "workload-identity") && (
            <option value="workload-identity">
              Workload Identity Federation
            </option>
          )}
        </select>
      </div>

      {authMethod === "password" && keyPairGenerator ? (
        <div className="col-md-12">
          <Callout status="warning" size="sm" mb="3">
            Snowflake is retiring password-only sign-in. Key pair is
            recommended.
          </Callout>
        </div>
      ) : null}

      {authMethod === "password" ? (
        <div className="form-group col-md-12">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            required={!canKeepExistingCredentials}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={
              canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
            }
          />
        </div>
      ) : null}

      {authMethod === "key-pair" && generatingKey ? (
        <div className="form-group col-md-12">
          <HelperText status="info" size="sm">
            Generating a key pair…
          </HelperText>
        </div>
      ) : null}

      {authMethod === "key-pair" && showGeneratedSummary ? (
        <div className="col-md-12">
          <Callout
            status="info"
            size="sm"
            mb="3"
            contentAlign="center"
            action={
              <Button
                variant="outline"
                size="sm"
                color="inherit"
                onClick={() => setShowOwnKey(true)}
              >
                Upload your own key
              </Button>
            }
          >
            A key pair was generated for this connection. The setup instructions
            include the public key.{" "}
            <Link onClick={onRegenerateClick}>Regenerate key pair</Link>
          </Callout>
        </div>
      ) : null}

      {authMethod === "key-pair" && !generatingKey && !showGeneratedSummary ? (
        <>
          <div className="form-group col-md-12">
            <label>Private Key File</label>
            <FileInput
              key={generation}
              name="privateKey"
              required={!canKeepExistingCredentials && !usingGeneratedKey}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  // Uploading is the fallback the error suggests, so clear it.
                  setGenerateFailed(false);
                  const reader = new FileReader();
                  reader.onload = () => {
                    onManualParamChange("privateKey", reader.result as string);
                  };
                  reader.readAsText(file);
                }
              }}
              placeholder={
                usingGeneratedKey
                  ? "Using the generated key. Choose a file to replace it."
                  : canKeepExistingCredentials
                    ? KEEP_EXISTING_PLACEHOLDER
                    : "Select a private key file"
              }
            />
            {keyPairGenerator ? (
              <Box mt="2">
                <Link onClick={onRegenerateClick}>
                  {usingGeneratedKey
                    ? "Regenerate key pair"
                    : "Generate key pair"}
                </Link>
              </Box>
            ) : null}
            {generationFailed ? (
              <HelperText status="error" size="sm" mt="1">
                This browser cannot generate keys here. Upload a key file
                instead.
              </HelperText>
            ) : null}
          </div>

          {!usingGeneratedKey ? (
            <div className="form-group col-md-12">
              <label>
                Private Key Password{" "}
                <Tooltip body="If your private key is encrypted, you will need to enter the password used to encrypt it.">
                  <GBInfo />
                </Tooltip>
              </label>
              <input
                type="text"
                className="form-control password-presentation"
                autoComplete="off"
                name="privateKeyPassword"
                value={params.privateKeyPassword || ""}
                onChange={onParamChange}
                placeholder={
                  canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
                }
              />
            </div>
          ) : null}
        </>
      ) : null}

      {authMethod === "workload-identity" && (
        <div className="form-group col-md-12">
          <label>Cloud Provider</label>
          <select
            className="form-control"
            name="workloadIdentityProvider"
            required
            value={params.workloadIdentityProvider || ""}
            onChange={(e) =>
              onManualParamChange("workloadIdentityProvider", e.target.value)
            }
          >
            <option value="" disabled>
              Select the cloud GrowthBook runs on…
            </option>
            <option value="AWS">AWS</option>
            <option value="AZURE">Azure</option>
            <option value="GCP">Google Cloud</option>
          </select>
          <small className="form-text text-muted">
            Authenticates with the ambient cloud identity of the GrowthBook
            server (for example, its AWS IAM role) — no stored credential. The
            Snowflake user must be configured with a matching{" "}
            <code>WORKLOAD_IDENTITY</code> binding. Self-hosted deployments
            only.
          </small>
        </div>
      )}

      <div className={`form-group ${hideSchema ? "col-md-12" : "col-md-6"}`}>
        <label>Database</label>
        <input
          type="text"
          className="form-control"
          name="database"
          required
          value={params.database || ""}
          onChange={onParamChange}
        />
      </div>
      {hideSchema ? null : (
        <div className="form-group col-md-6">
          <label>Schema</label>
          <input
            type="text"
            className="form-control"
            name="schema"
            required
            value={params.schema || ""}
            onChange={onParamChange}
          />
        </div>
      )}
      <div className="form-group col-md-6">
        <label>Role</label>
        <input
          type="text"
          className="form-control"
          name="role"
          value={params.role || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-6">
        <label>
          Warehouse (Optional){" "}
          <Tooltip body="If no Warehouse is specified, queries will be executed in the default Warehouse for your User, set in Snowflake." />
        </label>
        <input
          type="text"
          className="form-control"
          name="warehouse"
          value={params.warehouse || ""}
          onChange={onParamChange}
          placeholder=""
        />
      </div>
      <div className="col-md-12">
        <div className="form-group">
          <Switch
            id="access-url"
            label="Use Access URL (optional)"
            value={useAccessUrl}
            onChange={(v) => {
              setUseAccessUrl(v);
              if (!v) {
                onManualParamChange("accessUrl", "");
              }
            }}
          />
        </div>
      </div>
      {useAccessUrl && (
        <div className="form-group col-md-12">
          <label>
            Access URL{" "}
            <Tooltip body="Overrides Account to point GrowthBook at a specific URL" />
          </label>
          <input
            type="text"
            className="form-control"
            name="accessUrl"
            required
            value={params.accessUrl || ""}
            onChange={onParamChange}
          />
        </div>
      )}
      {confirmRegenerate ? (
        <ConfirmDialog
          title="Regenerate key pair?"
          content="This replaces the private key in the form right away. If this connection already ran the setup SQL in Snowflake, that user stops authenticating until you rerun it with the new key."
          yesText="Regenerate"
          onConfirm={async () => {
            setConfirmRegenerate(false);
            await regenerateKeyPair();
          }}
          onCancel={() => setConfirmRegenerate(false)}
        />
      ) : null}
    </div>
  );
};

export default SnowflakeForm;
