import { FC, ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";

const DataSourceSettingsOverride: FC<{
  value: {
    userIdColumn?: string;
    timestampColumn?: string;
    anonymousIdColumn?: string;
  };
  defaultValue: {
    userIdColumn?: string;
    timestampColumn?: string;
    anonymousIdColumn?: string;
  };
  noAnonymousId?: boolean;
  noTimestamp?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}> = ({ value, defaultValue, noAnonymousId, noTimestamp, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <a
        href="#"
        className="mb-1"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        {open ? <FaCaretUp /> : <FaCaretDown />}
        override defaults
      </a>
      {open && (
        <>
          <div className="form-group">
            <label>User Id Column</label>
            <input
              type="text"
              className="form-control"
              name="userIdColumn"
              onChange={onChange}
              placeholder={defaultValue?.userIdColumn}
              value={value?.userIdColumn || ""}
            />
          </div>
          {!noAnonymousId && (
            <div className="form-group">
              <label>Anonymous Id Column</label>
              <input
                type="text"
                className="form-control"
                name="anonymousIdColumn"
                onChange={onChange}
                placeholder={defaultValue?.anonymousIdColumn}
                value={value?.anonymousIdColumn || ""}
              />
            </div>
          )}
          {!noTimestamp && (
            <div className="form-group">
              <label>Timestamp Column</label>
              <input
                type="text"
                className="form-control"
                name="timestampColumn"
                onChange={onChange}
                placeholder={defaultValue?.timestampColumn}
                value={value?.timestampColumn || ""}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DataSourceSettingsOverride;
