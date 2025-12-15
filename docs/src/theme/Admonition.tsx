import React from "react";
// eslint-disable-next-line import/no-unresolved
import Admonition from "@theme-original/Admonition";

type Props = {
  children: React.ReactNode;
  type: "note" | "tip" | "info" | "warning" | "danger" | "caution" | "success";
  title: string;
  icon?: React.ReactNode;
};

const BulbIcon = () => {
  return (
    <svg fill="currentColor" viewBox="0 0 256 256">
      <path d="M180,232a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h80A12,12,0,0,1,180,232Zm40-128a91.51,91.51,0,0,1-35.17,72.35A12.26,12.26,0,0,0,180,186v2a20,20,0,0,1-20,20H96a20,20,0,0,1-20-20v-2a12,12,0,0,0-4.7-9.51A91.57,91.57,0,0,1,36,104.52C35.73,54.69,76,13.2,125.79,12A92,92,0,0,1,220,104Zm-24,0a68,68,0,0,0-69.65-68C89.56,36.88,59.8,67.55,60,104.38a67.71,67.71,0,0,0,26.1,53.19A35.87,35.87,0,0,1,100,184h56.1A36.13,36.13,0,0,1,170,157.49,67.68,67.68,0,0,0,196,104Zm-20.07-5.32a48.5,48.5,0,0,0-31.91-40,12,12,0,0,0-8,22.62,24.31,24.31,0,0,1,16.09,20,12,12,0,0,0,23.86-2.64Z"></path>
    </svg>
  );
};

const InfoIcon = () => {
  return (
    <svg fill="currentColor" viewBox="0 0 256 256">
      <path d="M108,84a16,16,0,1,1,16,16A16,16,0,0,1,108,84Zm128,44A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Zm-72,36.68V132a20,20,0,0,0-20-20,12,12,0,0,0-4,23.32V168a20,20,0,0,0,20,20,12,12,0,0,0,4-23.32Z"></path>
    </svg>
  );
};

const NoteIcon = () => {
  return (
    <svg fill="currentColor" viewBox="0 0 256 256">
      <path d="M84,108A12,12,0,0,1,96,96h64a12,12,0,0,1,0,24H96A12,12,0,0,1,84,108Zm32,28H96a12,12,0,0,0,0,24h20a12,12,0,0,0,0-24ZM228,48V156.69a19.86,19.86,0,0,1-5.86,14.14l-51.31,51.31A19.86,19.86,0,0,1,156.69,228H48a20,20,0,0,1-20-20V48A20,20,0,0,1,48,28H208A20,20,0,0,1,228,48ZM52,204h92V156a12,12,0,0,1,12-12h48V52H52Zm139-36H168v23Z"></path>
    </svg>
  );
};

const WarningIcon = () => {
  return (
    <svg fill="currentColor" viewBox="0 0 256 256">
      <path d="M240.26,186.1,152.81,34.23h0a28.74,28.74,0,0,0-49.62,0L15.74,186.1a27.45,27.45,0,0,0,0,27.71A28.31,28.31,0,0,0,40.55,228h174.9a28.31,28.31,0,0,0,24.79-14.19A27.45,27.45,0,0,0,240.26,186.1Zm-20.8,15.7a4.46,4.46,0,0,1-4,2.2H40.55a4.46,4.46,0,0,1-4-2.2,3.56,3.56,0,0,1,0-3.73L124,46.2a4.77,4.77,0,0,1,8,0l87.44,151.87A3.56,3.56,0,0,1,219.46,201.8ZM116,136V104a12,12,0,0,1,24,0v32a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,176Z"></path>
    </svg>
  );
};

const DangerIcon = () => {
  return (
    <svg fill="currentColor" viewBox="0 0 256 256">
      <path d="M116,132V80a12,12,0,0,1,24,0v52a12,12,0,0,1-24,0ZM236,91.55v72.9a19.86,19.86,0,0,1-5.86,14.14l-51.55,51.55A19.85,19.85,0,0,1,164.45,236H91.55a19.85,19.85,0,0,1-14.14-5.86L25.86,178.59A19.86,19.86,0,0,1,20,164.45V91.55a19.86,19.86,0,0,1,5.86-14.14L77.41,25.86A19.85,19.85,0,0,1,91.55,20h72.9a19.85,19.85,0,0,1,14.14,5.86l51.55,51.55A19.86,19.86,0,0,1,236,91.55Zm-24,1.66L162.79,44H93.21L44,93.21v69.58L93.21,212h69.58L212,162.79ZM128,156a16,16,0,1,0,16,16A16,16,0,0,0,128,156Z"></path>
    </svg>
  );
};

export default function AdmonitionWrapper(props: Props) {
  switch (props.type) {
    case "note":
      return (
        <Admonition
          type="note"
          {...props}
          icon={<NoteIcon />}
          className={!props.title && "uppercase"}
        />
      );
    case "tip":
    case "success":
      return (
        <Admonition
          type="tip"
          {...props}
          icon={<BulbIcon />}
          className={!props.title && "uppercase"}
        />
      );
    case "info":
      return (
        <Admonition
          type="info"
          {...props}
          icon={<InfoIcon />}
          className={!props.title && "uppercase"}
        />
      );
    case "warning":
    case "caution":
      return (
        <Admonition
          type="warning"
          {...props}
          icon={<WarningIcon />}
          className={!props.title && "uppercase"}
        />
      );
    case "danger":
      return (
        <Admonition
          type="danger"
          {...props}
          icon={<DangerIcon />}
          className={!props.title && "uppercase"}
        />
      );
    default:
      return <Admonition {...props} />;
  }
}
