import {
  FC,
  useState,
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  ReactNode,
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
  stopPropagation?: boolean;
}

const Button: FC<Props> = ({
  color = "primary",
  onClick,
  children,
  description,
  className,
  disabled,
  loading: _externalLoading,
  stopPropagation,
  ...otherProps
}) => {
  const [_internalLoading, setLoading] = useState(false);
  const [error, setError] = useState<boolean | null>(false);
  const loading = _externalLoading || _internalLoading;

  return (
    <>
      <button
        {...otherProps}
        className={clsx("btn", className, {
          "btn-secondary disabled": loading,
          [`btn-${color}`]: !loading,
        })}
        disabled={disabled || loading}
        onClick={async (e) => {
          e.preventDefault();
          if (stopPropagation) e.stopPropagation();
          if (loading) return;
          setLoading(true);
          setError(null);

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
            <LoadingSpinner /> Loading
          </>
        ) : (
          children
        )}
      </button>
      {error && <pre className="text-danger ml-2">{error}</pre>}
      {!error && !loading && description ? (
        <small>
          <em>{description}</em>
        </small>
      ) : (
        ""
      )}
    </>
  );
};

export default Button;