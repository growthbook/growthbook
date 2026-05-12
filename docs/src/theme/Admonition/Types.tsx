import React from "react";
// eslint-disable-next-line import/no-unresolved
import DefaultAdmonitionTypes from "@theme-original/Admonition/Types";

type AdmonitionProps = {
  title?: string;
  children?: React.ReactNode;
};

function extractText(node: React.ReactNode): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  return "";
}

function ProFeatureAdmonition({ title, children }: AdmonitionProps) {
  const description = extractText(children).trim() || undefined;
  return (
    <p className="commercial-feature commercial-feature--pro" role="note">
      <span className="commercial-feature-badge commercial-feature-badge--pro">
        Pro
      </span>
      <span className="commercial-feature-text">
        <strong>{title}</strong> is available on Pro and Enterprise plans.
        {description ? ` ${description}` : ""}
      </span>
    </p>
  );
}

function EnterpriseFeatureAdmonition({ title, children }: AdmonitionProps) {
  const description = extractText(children).trim() || undefined;
  return (
    <p
      className="commercial-feature commercial-feature--enterprise"
      role="note"
    >
      <span className="commercial-feature-badge commercial-feature-badge--enterprise">
        Enterprise
      </span>
      <span className="commercial-feature-text">
        <strong>{title}</strong> is available on Enterprise plans.
        {description ? ` ${description}` : ""}
      </span>
    </p>
  );
}

const AdmonitionTypes = {
  ...DefaultAdmonitionTypes,
  "pro-feature": ProFeatureAdmonition,
  "enterprise-feature": EnterpriseFeatureAdmonition,
};

export default AdmonitionTypes;
