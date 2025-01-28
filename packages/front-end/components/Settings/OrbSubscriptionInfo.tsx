import Callout from "../Radix/Callout";

interface Props {
  portalUrl?: string;
  portalError?: string;
}

export default function OrbSubscriptionInfo({ portalUrl, portalError }: Props) {
  return (
    <div>
      {portalUrl ? (
        <iframe
          src={portalUrl}
          style={{
            width: "100%",
            height: "80vh",
            border: "none",
          }}
          title="Customer Portal"
        />
      ) : null}
      {portalError ? <Callout status="error">{portalError}</Callout> : null}
    </div>
  );
}
