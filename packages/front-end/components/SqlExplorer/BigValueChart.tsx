import React from "react";

type Props = {
  value: number | string;
  label?: string;
};

export default function BigValueChart({ value, label }: Props) {
  if (value === undefined || value === null) {
    return <div style={{ textAlign: "center", color: "#888" }}>No data</div>;
  }
  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      <div style={{ fontSize: "3rem", fontWeight: "bold" }}>{value}</div>
      {label && (
        <div style={{ fontSize: "1.2rem", color: "#888" }}>{label}</div>
      )}
    </div>
  );
}
