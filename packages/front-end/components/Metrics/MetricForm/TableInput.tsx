import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { useRef, useState } from "react";
import Fuse from "fuse.js";
import clsx from "clsx";
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
  const [showDropdown, setShowDropdown] = useState(false);
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

  const inputRef = useRef(null);

  function handleClick() {
    if (showDropdown) {
      inputRef.current.blur();
    } else {
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
    }
  }

  return (
    <div>
      <div className="d-flex flex-column">
        <label>{label}</label>
        <div className="d-flex">
          <input
            className={(styles.input, "form-control")}
            placeholder="Enter a table name..."
            value={value}
            onClick={() => handleClick()}
            onChange={(e) => {
              onChange(e.target.value, "");
              setFilteredItems(fuse.search(e.target.value));
            }}
            ref={inputRef}
            onBlur={() => {
              console.log("on blur happened");
              setShowDropdown(false);
            }}
          />
        </div>
      </div>
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
