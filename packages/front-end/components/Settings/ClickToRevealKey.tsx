import { SecretApiKey } from "back-end/types/apikey";
import clsx from "clsx";
import { useState } from "react";
import { useAuth } from "../../services/auth";
import ClickToCopy from "./ClickToCopy";
import styles from "./ClickToRevealKey.module.scss";

export default function ClickToRevealKey({ keyId }) {
  const [hideText, setHideText] = useState(true);
  const [keyValue, setKeyValue] = useState<string | null>();
  const { apiCall } = useAuth();
  return (
    <div
      className={clsx(
        "d-flex",
        !keyValue ? "align-items-center" : "flex-column align-items-start"
      )}
    >
      <ClickToCopy valueToCopy={keyValue}>
        <span style={{ overflowWrap: "anywhere" }}>
          {keyValue ? keyValue : "Click to reveal the api key"}
        </span>
      </ClickToCopy>
      <button
        className={clsx(
          "btn btn-sm btn-outline-primary",
          styles.button,
          keyValue && "mt-2"
        )}
        onClick={async () => {
          setHideText(!hideText);
          if (!keyValue) {
            const res = await apiCall<{ key: SecretApiKey }>(`/keys/reveal`, {
              method: "POST",
              body: JSON.stringify({
                id: keyId,
              }),
            });
            if (!res.key.key) {
              throw new Error("Could not load the secret key");
            }
            setKeyValue(res.key.key);
            return;
          }
          setKeyValue(null);
        }}
      >
        {hideText ? "Reveal api key" : "Hide api key"}
      </button>
    </div>
  );
}
