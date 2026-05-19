import Callout from "@/ui/Callout";

export default function CardVerificationNotice() {
  return (
    <Callout status="info" size="sm" mt="3">
      <strong>$1.00 authorization:</strong> To verify your card is chargeable,
      we&apos;ll place a temporary $1.00 hold on it. This is{" "}
      <strong>not a charge</strong> &mdash; it&apos;s voided immediately and
      your bank releases the hold automatically (usually within minutes,
      occasionally up to a few business days).
    </Callout>
  );
}
