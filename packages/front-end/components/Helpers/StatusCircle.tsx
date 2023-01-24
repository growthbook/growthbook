import React from "react";

export interface Props {
  className: string;
}

export default function StatusCircle({ className }: Props) {
  return (
    <div
      className={className}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        width: 10,
        height: 10,
        marginRight: 5,
        borderRadius: 20,
      }}
    />
  );
}
