// packages/front-end/components/PasswordInput.tsx
"use client";

import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: string | null;
};

/** SVG icons (no extra dependency) */
const Eye = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="text-gray-500"
  >
    <path
      d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const EyeOff = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="text-gray-500"
  >
    <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" />
    <path
      d="M10.6 6.2A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18.2 18.2 0 0 1-5.1 5.4"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M6.2 10.7A12 12 0 0 0 1 12s4 7 11 7c1.3 0 2.6-.3 3.8-.7"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/**
 * Password input with show/hide toggle — polished version
 * Responsive + visually aligned with GrowthBook form fields
 */
const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
  function PasswordInput({ className, error, style, ...rest }, ref) {
    const [visible, setVisible] = React.useState(false);

    return (
      <div style={{ position: "relative" }}>
        <input
          {...rest}
          ref={ref}
          type={visible ? "text" : "password"}
          className={`form-control ${
            error ? "is-invalid" : ""
          } ${className || ""}`}
          style={{
            paddingRight: "42px",
            fontSize: "0.95rem",
            height: "42px",
            ...style,
          }}
        />

        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          className="toggle-password-btn"
          style={{
            background: "transparent",
            border: "none",
            position: "absolute",
            top: "50%",
            right: "12px",
            transform: "translateY(-50%)",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {visible ? <Eye /> : <EyeOff />}
        </button>

        {error ? (
          <div
            className="invalid-feedback d-block"
            style={{ fontSize: "0.8rem", marginTop: "4px" }}
          >
            {error}
          </div>
        ) : null}
      </div>
    );
  },
);

export default PasswordInput;
