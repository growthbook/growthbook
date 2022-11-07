import { ReactElement, ReactNode, useState } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import LoadingSpinner from "../LoadingSpinner";
import Tooltip from "../Tooltip/Tooltip";

export interface Props {
  valueWhenHidden: ReactNode;
  getValue: () => Promise<string>;
  children: (value: string) => ReactElement;
}

export default function ClickToReveal({
  valueWhenHidden,
  getValue,
  children,
}: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (value) {
    return children(value);
  }

  if (loading) {
    return (
      <span>
        <LoadingSpinner /> loading...
      </span>
    );
  }

  return (
    <a
      href="#"
      onClick={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
          const actualValue = await getValue();
          setValue(actualValue);
        } catch (e) {
          console.error(e);
          setError(e.message);
        }
        setLoading(false);
      }}
    >
      {valueWhenHidden}{" "}
      {error && (
        <Tooltip body={error}>
          <FaExclamationTriangle className="text-danger" />
        </Tooltip>
      )}
    </a>
  );
}
