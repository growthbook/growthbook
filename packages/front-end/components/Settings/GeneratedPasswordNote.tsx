import HelperText from "@/ui/HelperText";

export default function GeneratedPasswordNote({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <HelperText status="info" size="sm" mt="1">
      We generated a secure password for you to use.
    </HelperText>
  );
}
