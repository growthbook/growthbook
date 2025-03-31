import React from "react";
// eslint-disable-next-line import/no-unresolved
import useBrokenLinks from "@docusaurus/useBrokenLinks";

export default function Anchor(props) {
  useBrokenLinks().collectAnchor(props.id);
  return <a {...props} />;
}
