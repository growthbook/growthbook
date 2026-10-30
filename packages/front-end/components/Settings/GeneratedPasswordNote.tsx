export default function GeneratedPasswordNote({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <small className="form-text text-muted">
      We generated a secure password for you to use.
    </small>
  );
}
