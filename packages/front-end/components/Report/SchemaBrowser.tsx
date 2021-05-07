import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import { EventInterface } from "../../pages/events";
import LoadingOverlay from "../LoadingOverlay";

const SchemaBrowser: FC = () => {
  const { data, error } = useApi<{
    events: EventInterface[];
    schema: string;
  }>(`/events`);

  const [expanded, setExpanded] = useState<null | string>(null);

  if (error) {
    return <div>There was a problem loading the report</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      <strong>Events and Properties</strong>
      <ul>
        {data.events.map((event) => (
          <li
            key={event.name}
            className={expanded === event.name ? "expanded" : ""}
            onClick={() => setExpanded(event.name)}
          >
            <strong>{event.name}</strong>
            <ul>
              {event.properties.map((prop) => (
                <li key={prop.name}>{prop.name}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SchemaBrowser;
