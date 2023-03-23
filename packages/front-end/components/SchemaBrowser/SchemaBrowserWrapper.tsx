import { FaDatabase } from "react-icons/fa";

export default function SchemaBrowserWrapper({
  children,
  datasourceName,
}: {
  children: React.ReactNode;
  datasourceName: string;
}) {
  return (
    <div className="d-flex flex-column">
      <div>
        <label className="font-weight-bold mb-1">
          <FaDatabase /> {datasourceName}
        </label>
      </div>
      {children}
    </div>
  );
}
