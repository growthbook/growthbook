export interface Props {
  value: number;
  setValue: (value: number) => void;
  label?: string;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RolloutPercentInput({
  value,
  setValue,
  label = "Percent of Users",
}: Props) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div className="row align-items-center">
        <div className="col">
          <input
            value={value}
            onChange={(e) => {
              setValue(parseFloat(e.target.value));
            }}
            min="0"
            max="1"
            step="0.01"
            type="range"
            className="w-100"
          />
        </div>
        <div className="col-auto" style={{ fontSize: "1.3em", width: "4em" }}>
          {percentFormatter.format(value)}
        </div>
      </div>
    </div>
  );
}
