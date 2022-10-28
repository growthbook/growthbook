import { SecretApiKey } from "back-end/types/apikey";
import clsx from "clsx";
import { useCallback, useState } from "react";
import { FaExclamationTriangle, FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import Tooltip from "../Tooltip";

export type SecretKey = {
  [key: string]: string;
};
export interface Props {
  rowReverse?: boolean;
  keyId: string;
  currentCopiedString: string;
  setCurrentCopiedString: (value: string) => void;
}

export default function RevealHiddenKey({
  keyId,
  rowReverse,
  currentCopiedString,
  setCurrentCopiedString,
}: Props) {
  const { apiCall } = useAuth();
  const [error, setError] = useState("");
  const [revealedSecretKey, setRevealedSecretKey] = useState<SecretKey | null>(
    {}
  );

  const hidden = !revealedSecretKey || !revealedSecretKey[keyId];

  const handleGetKey = useCallback(async () => {
    if (hidden) {
      try {
        const res = await apiCall<{ key: SecretApiKey }>(`/keys/reveal`, {
          method: "POST",
          body: JSON.stringify({
            id: keyId,
          }),
        });
        setRevealedSecretKey({
          [keyId]: res.key.encryptSDK ? res.key.encryptionKey : res.key.key,
        });
      } catch (e) {
        setError(e.message);
      }
    } else {
      setRevealedSecretKey(null);
    }
  }, [hidden, apiCall, keyId]);

  return (
    <div
      className={clsx("d-flex", rowReverse ? "flex-row-reverse" : "flex-row")}
    >
      <span role="button" onClick={handleGetKey}>
        {hidden ? <FaEyeSlash /> : <FaEye />}
      </span>
      <Tooltip
        className={!hidden && "w-100"}
        role="button"
        tipMinWidth="45px"
        tipPosition="top"
        body={
          hidden
            ? "Click the eye to reveal"
            : currentCopiedString === keyId
            ? "Copied!"
            : "Copy"
        }
        style={{ paddingLeft: "5px" }}
        onClick={(e) => {
          e.preventDefault();
          if (!hidden) {
            navigator.clipboard
              .writeText(revealedSecretKey[keyId])
              .then(() => {
                setCurrentCopiedString(keyId);
              })
              .catch((e) => {
                setError(e.message);
                console.error(e);
              });
          }
        }}
      >
        <input
          role="button"
          type={hidden ? "password" : "text"}
          value={hidden ? "Click to reveal key." : revealedSecretKey[keyId]}
          disabled={true}
          style={{
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            textOverflow: hidden ? "clip" : "ellipsis",
            textAlign: rowReverse ? "right" : "left",
            paddingRight: rowReverse ? "5px" : "0px",
            width: "100%",
          }}
        />
      </Tooltip>
      {error && (
        <Tooltip body={error}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      )}
    </div>
  );
}
