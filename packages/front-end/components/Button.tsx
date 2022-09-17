import { FC, useState, ButtonHTMLAttributes, DetailedHTMLProps } from "react";
import clsx from "clsx";
import LoadingSpinner from "./LoadingSpinner";
import { ReactNode } from "react";

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
}

const Button: FC<Props> = ({
  color = "primary",
  onClick,
  children,
  description,
  className,
  disabled,
  ...otherProps
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

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
