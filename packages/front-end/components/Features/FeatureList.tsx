import Link from "next/link";
import { FeatureInterface } from "back-end/types/feature";
import { ago, datetime } from "../../services/dates";
import ValueDisplay from "./ValueDisplay";

export interface Props {
  features: FeatureInterface[];
}

export default function FeatureList({ features }: Props) {
  return (
    <ul className="list-unstyled simple-divider ">
      {features
        .sort(
          (a, b) =>
            new Date(b.dateCreated).getTime() -
            new Date(a.dateCreated).getTime()
        )
        .slice(0, 5)
        .map((feature) => {
          return (
            <li key={feature.id} className="w-100 hover-highlight">
              <div className="d-flex">
                <Link href={`/feature/${feature.id}`}>
                  <a className="w-100 no-link-color">
                    <div className="d-flex w-100">
                      <div className="mb-1">
                        <strong>{feature.id}</strong>{" "}
                      </div>
                      <div style={{ flex: 1 }} />
                      <div className="">
                        <ValueDisplay
                          value={feature.defaultValue}
                          type={feature.valueType}
                        />
                      </div>
                    </div>
                    <div className="d-flex">
                      <div
                        className="text-muted"
                        title={datetime(feature.dateCreated)}
                      >
                        {ago(feature.dateCreated)}
                      </div>
                    </div>
                  </a>
                </Link>
              </div>
            </li>
          );
        })}
    </ul>
  );
}
