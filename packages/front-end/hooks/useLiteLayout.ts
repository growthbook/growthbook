import React, { useState } from "react";

export type UseLiteLayout = [
  boolean,
  React.Dispatch<React.SetStateAction<boolean>>
];

export function useLiteLayout(_isLiteLayout: boolean): UseLiteLayout {
  const [isLiteLayout, setIsLiteLayout] = useState(_isLiteLayout);
  return [isLiteLayout, setIsLiteLayout];
}
