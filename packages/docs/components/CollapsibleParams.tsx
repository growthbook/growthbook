interface CollapsibleParamsProps {
  children: React.ReactNode;
}

export default function CollapsibleParams({
  children,
}: CollapsibleParamsProps) {
  return (
    <details className="text-md">
      <summary>child parameters</summary>
      <div className="ml-3 p-3 text-md">{children}</div>
    </details>
  );
}
