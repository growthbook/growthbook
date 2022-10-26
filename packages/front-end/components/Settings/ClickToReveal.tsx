import { SecretApiKey } from "back-end/types/apikey";
import { useState } from "react";
import { FaExclamationTriangle, FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import Tooltip from "../Tooltip";

export type RevealedPrivateKey = {
  [key: string]: string;
};
export interface Props {
  rowReverse?: boolean;
  keyId: string;
}

export default function ClickToReveal({ keyId, rowReverse }: Props) {
  const { apiCall } = useAuth();
  const [error, setError] = useState("");
  const [revealedPrivateKey, setRevealedPrivateKey] =
    useState<RevealedPrivateKey | null>({});
  const [currentCopiedString, setCurrentCopiedString] = useState("");

  const hidden = !revealedPrivateKey || !revealedPrivateKey[keyId];

  return (
    <div className={rowReverse && "d-flex flex-row-reverse"}>
      <span
        role="button"
        onClick={async () => {
          if (hidden) {
            try {
              const res = await apiCall<{ key: SecretApiKey }>(`/keys/reveal`, {
                method: "POST",
                body: JSON.stringify({
                  id: keyId,
                }),
              });
              setRevealedPrivateKey({
                [keyId]: res.key.key,
              });
            } catch (e) {
              setError(e.message);
            }
          } else {
            setRevealedPrivateKey(null);
          }
        }}
      >
        {hidden ? <FaEyeSlash /> : <FaEye />}
      </span>
      <Tooltip
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
              .writeText(revealedPrivateKey[keyId])
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
          value={hidden ? "Click to reveal key." : revealedPrivateKey[keyId]}
          disabled={true}
          style={{
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            textOverflow: "ellipsis",
            textAlign: rowReverse ? "right" : "left",
            paddingRight: rowReverse ? "5px" : "0px",
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
