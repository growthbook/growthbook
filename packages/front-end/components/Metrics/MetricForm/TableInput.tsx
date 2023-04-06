import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { useState } from "react";
import Fuse from "fuse.js";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import useApi from "@/hooks/useApi";
import styles from "./TableInput.module.scss";

type Props = {
  datasourceId: string;
  value: string;
  onChange: (e: string, id: string) => void;
  label: string;
};

export default function TableInput({
  datasourceId,
  value,
  onChange,
  label,
}: Props) {
  const [filteredItems, setFilteredItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(true);
  const items = [];
  const { data } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasourceId}/schema`);

  const informationSchema = data?.informationSchema;

  if (informationSchema?.databases.length) {
    informationSchema.databases.forEach((database) => {
      database.schemas.forEach((schema) => {
        schema.tables.forEach((table) => {
          items.push(table);
        });
      });
    });
  }

  const fuse = new Fuse(items, {
    includeScore: false,
    keys: ["tableName"],
  });

  return (
    <div
      onFocus={() => {
        setShowDropdown(true);
        if (!value && !filteredItems.length) {
          setFilteredItems(
            items.map((item) => {
              return {
                item,
              };
            })
          );
        }
      }}
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
        placeholder="Enter a table name..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value, "");
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
              onMouseDown={() => onChange(item.item.tableName, item.item.id)}
            >
              {item.item.tableName}
            </li>
          ))}
        </div>
      )}
    </div>
  );
}
