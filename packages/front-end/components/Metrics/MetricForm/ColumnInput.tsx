import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import { useState } from "react";
import Fuse from "fuse.js";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import useApi from "@/hooks/useApi";
import styles from "./ColumnInput.module.scss";

type Props = {
  datasourceId: string;
  tableId: string;
  value: string;
  onChange: (e: string) => void;
  placeholder?: string;
  label?: string;
};

export default function ColumnInput({
  datasourceId,
  tableId,
  value,
  onChange,
  placeholder = "received_at",
  label,
}: Props) {
  const [filteredItems, setFilteredItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(true);
  const items = [];
  const { data } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`);

  if (data?.table?.columns.length) {
    data.table.columns.forEach((column) => {
      items.push(column);
    });
  }

  const fuse = new Fuse(items, {
    includeScore: false,
    keys: ["columnName"],
  });

  return (
    <div
      onFocus={() => setShowDropdown(true)}
      onBlur={(e) => {
        e.preventDefault();
        if (showDropdown) {
          setShowDropdown(false);
        }
      }}
    >
      <Field
        name="table"
        label={label}
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setFilteredItems(fuse.search(e.target.value));
        }}
      />
      {filteredItems.length > 0 && showDropdown && (
        <div className={clsx(styles.dropdown, "p-2 border rounded")}>
          {filteredItems.map((item) => (
            <li
              className={styles.dropdownItem}
              role="button"
              key={item.item.id}
              onMouseDown={() => onChange(item.item.columnName)}
            >
              {item.item.columnName}
            </li>
          ))}
        </div>
      )}
    </div>
  );
}
