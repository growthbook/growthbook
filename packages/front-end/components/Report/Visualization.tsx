import { FC } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import {
  Visualization as VisInterface,
  QueryResult,
} from "../../types/reports";

const getComponents = (type: string): [React.ReactType, React.ReactType] => {
  if (type === "LineChart") {
    return [LineChart, Line];
  } else if (type === "BarChart") {
    return [BarChart, Bar];
  } else if (type === "AreaChart") {
    return [AreaChart, Area];
  }

  return [null, null];
};

const Visualization: FC<{ visualization: VisInterface; data: QueryResult }> = ({
  visualization: { type, title, xAxis, yAxis },
  data,
}) => {
  if (!xAxis.length || !yAxis.length) {
    return <em>Add columns to the X and Y axis</em>;
  }

  const [Component, DataComponent] = getComponents(type);

  if (!Component) {
    return <div className="alert alert-danger">Unknown chart type: {type}</div>;
  }

  return (
    <div className="text-center">
      <h4>{title}</h4>
      <ResponsiveContainer height={300}>
        <Component data={data.rows} height={300}>
          <CartesianGrid strokeDasharray="3 3" />
          <Tooltip />
          <Legend />
          <XAxis dataKey={xAxis[0]} />
          <YAxis />
          {yAxis.map((col) => (
            <DataComponent
              type="monotone"
              dataKey={col}
              stroke="#8884d8"
              key={col}
            />
          ))}
        </Component>
      </ResponsiveContainer>
    </div>
  );
};

export default Visualization;
