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
  onClick: () => Promise<void>;
  disabled?: boolean;
  description?: string;
  children: ReactNode;
  loading?: boolean;
}

const Button: FC<Props> = ({
  color = "primary",
  onClick,
  children,
  description,
  className,
  disabled,
  loading: _externalLoading,
  ...otherProps
}) => {
  const [_internalLoading, setLoading] = useState(false);
  const [error, setError] = useState(false);
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
