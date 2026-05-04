import clsx from "clsx";
import { useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import ClickToCopy from "./ClickToCopy";
import styles from "./ClickToReveal.module.scss";

type Props = {
  valueWhenHidden: string;
  getValue: () => Promise<string>;
};

export default function ClickToReveal({ getValue, valueWhenHidden }: Props) {
  const [error, setError] = useState("");
  const [value, setValue] = useState<string | null>();
  const [loading, setLoading] = useState(false);
  return (
    <div className={clsx(styles.wrapper, value && "d-flex align-items-center")}>
      {value ? (
        <ClickToCopy>{value}</ClickToCopy>
      ) : (
        <span className={styles.blurText}>{valueWhenHidden}</span>
      )}
      <button
        className={clsx(
          "btn btn-sm btn-outline-secondary",
          styles.button,
          value && "ml-2",
          !value && styles.buttonLeft,
        )}
        onClick={async () => {
          if (!value) {
            try {
              setLoading(true);
              setValue(await getValue());
              setLoading(false);
            } catch (e) {
              setError(e.message);
            }
          } else {
            setValue(null);
          }
        }}
      >
        {loading ? <LoadingSpinner /> : !value ? "Reveal" : "Hide"}
      </button>
      {error && (
        <Tooltip body={error}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      )}
    </div>
  );
}
