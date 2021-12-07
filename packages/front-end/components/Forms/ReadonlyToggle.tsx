export default function ReadonlyToggle({ value }: { value: boolean }) {
  return (
    <div className="toggle-switch">
      <input type="checkbox" checked={value} disabled={true} />
      <label></label>
    </div>
  );
}
