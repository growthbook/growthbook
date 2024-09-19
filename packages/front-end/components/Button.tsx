import {
  FC,
  useState,
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  ReactNode,
  CSSProperties,
  useEffect,
} from "react";
import clsx from "clsx";
import LoadingSpinner from "./LoadingSpinner";

interface Props
  extends DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  color?: string;
  onClick: (() => Promise<void>) | (() => void);
  disabled?: boolean;
  description?: string;
  children: ReactNode;
  loading?: boolean;
  loadingClassName?: string;
  stopPropagation?: boolean;
  loadingCta?: string;
  errorClassName?: string;
  errorStyle?: CSSProperties;
  setErrorText?: (s: string) => void;
}

const Button: FC<Props> = ({
  color = "primary",
  onClick,
  children,
  description,
  className,
  disabled,
  loading: _externalLoading,
  loadingClassName = "btn-secondary disabled",
  stopPropagation,
  loadingCta = "Loading",
  errorClassName = "text-danger ml-2",
  errorStyle,
  setErrorText,
  ...otherProps
}) => {
  const [_internalLoading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const loading = _externalLoading || _internalLoading;

  useEffect(() => {
    if (setErrorText) {
      setErrorText(error);
    }
  }, [setErrorText, error]);

  return (
    <>
      <button
        {...otherProps}
        className={clsx("btn", className, {
          [loadingClassName]: loading,
          [`btn-${color}`]: !loading,
        })}
        disabled={disabled || loading}
        onClick={async (e) => {
          e.preventDefault();
          if (stopPropagation) e.stopPropagation();
          if (loading) return;
          setLoading(true);
          setError("");

          try {
            await onClick();
          } catch (e) {
            setError(e.message);
          }

          setLoading(false);
        }}
      >
        {loading ? (
          <>
            <LoadingSpinner /> {loadingCta}
          </>
        ) : (
          children
        )}
      </button>
      {error && !setErrorText ? (
        <pre className={errorClassName} style={errorStyle}>
          {error}
        </pre>
      ) : null}
      {!error && !loading && description ? (
        <small>
          <em>{description}</em>
        </small>
      ) : null}
    </>
  );
};

export default Button;
