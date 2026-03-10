import { FC, useState } from "react";
import { FaTrash, FaPlus } from "react-icons/fa";

const VariationDataForm: FC<{
  variationNames: string[];
  data: string;
  featureFlag?: boolean;
  setData: (data: string) => void;
}> = ({ variationNames, data, setData, featureFlag = false }) => {
  const [newKey, setNewKey] = useState("");

  const parsed: {
    [key: string]: string[];
  } = data.length > 2 ? JSON.parse(data) || {} : {};

  const onChange = (key: string, i: number, val: string) => {
    const newValues = [...parsed[key]];
    newValues.splice(i, 1, val);

    setData(
      JSON.stringify({
        ...parsed,
        [key]: newValues,
      }),
    );
  };
  const removeKey = (key: string) => {
    const clone = { ...parsed };
    delete clone[key];
    setData(JSON.stringify(clone));
  };
  const addKey = (key: string) => {
    setData(
      JSON.stringify({
        ...parsed,
        [key]: new Array(variationNames.length).fill(""),
      }),
    );
  };

  return (
    <div>
      <div className="mb-2">
        {featureFlag ? "Set Feature Flags" : "Variation Data (optional)"}
      </div>
      {Object.keys(parsed).length > 0 && (
        <table className="table table-condensed table-bordered">
          <thead>
            <tr>
              <th>{featureFlag ? "Flag" : "Key"}</th>
              {variationNames.map((name) => (
                <th key={name}>{name}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.keys(parsed).map((key) => (
              <tr key={key}>
                <td>{key}</td>
                {variationNames.map((name, i) => (
                  <td key={i}>
                    <input
                      type="text"
                      value={parsed[key][i] || ""}
                      className="form-control"
                      onChange={(e) => {
                        onChange(key, i, e.target.value);
                      }}
                    />
                  </td>
                ))}
                <td>
                  <a
                    href="#"
                    className="text-danger"
                    onClick={(e) => {
                      e.preventDefault();
                      removeKey(key);
                    }}
                  >
                    <FaTrash />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <div className="col-auto">
          <div className="input-group">
            <div className="input-group-prepend">
              <div className="input-group-text">
                {featureFlag ? "Flag" : "New Key"}:
              </div>
            </div>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="form-control"
              placeholder={
                featureFlag ? "e.g. homepage.button.color" : "e.g. buttonColor"
              }
            />
            <div className="input-group-append">
              <button
                className="btn btn-outline-primary"
                onClick={(e) => {
                  e.preventDefault();
                  addKey(newKey);
                  setNewKey("");
                }}
              >
                <FaPlus /> Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VariationDataForm;
