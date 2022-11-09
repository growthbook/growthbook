import { SecretApiKey } from "back-end/types/apikey";
import clsx from "clsx";
import { useState } from "react";
import { useAuth } from "../../services/auth";
import LoadingSpinner from "../LoadingSpinner";
import ClickToCopy from "./ClickToCopy";
import styles from "./ClickToRevealKey.module.scss";

export default function ClickToRevealKey({ keyId }) {
  const [hideText, setHideText] = useState(true);
  const [keyValue, setKeyValue] = useState<string | null>();
  const [loading, setLoading] = useState(false);
  const { apiCall } = useAuth();
  return (
    <div
      className={clsx(
        styles.wrapper,
        keyValue && "d-flex flex-column align-items-baseline"
      )}
    >
      <ClickToCopy valueToCopy={keyValue}>
        {keyValue ? keyValue : "Click to reveal the api key"}
      </ClickToCopy>
      <button
        className={clsx(
          "btn btn-sm btn-outline-secondary",
          styles.button,
          keyValue && "mt-2",
          !keyValue && styles.buttonLeft
        )}
        onClick={async () => {
          setHideText(!hideText);
          if (!keyValue) {
            setLoading(true);
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
            setLoading(false);
            return;
          }
          setKeyValue(null);
        }}
      >
        {loading ? <LoadingSpinner /> : hideText ? "Reveal key" : "Hide key"}
      </button>
    </div>
  );
}
