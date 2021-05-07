import { FC } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const DateRange: FC<{
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}> = ({ from, to, onChange }) => {
  return (
    <div className="d-flex align-items-center">
      <div>
        <DatePicker
          selected={from}
          onChange={(date: Date) => onChange(date, to)}
          selectsStart
          startDate={from}
          endDate={to}
          className="form-control"
        />
      </div>
      <span className="px-1">to</span>
      <div>
        <DatePicker
          selected={to}
          onChange={(date: Date) => onChange(from, date)}
          selectsEnd
          startDate={from}
          endDate={to}
          minDate={from}
          className="form-control"
        />
      </div>
    </div>
  );
};

export default DateRange;
