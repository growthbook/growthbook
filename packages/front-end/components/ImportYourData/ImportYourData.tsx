import React, { FC } from "react";
import Link from "next/link";

type ImportYourDataProps = Record<string, never>; // TODO: Replace with props object

export const ImportYourData: FC<ImportYourDataProps> = (_props) => {
  return (
    <div>
      <h1>ImportYourData</h1>
      {/* TODO: style */}
      <ul>
        <li>
          <Link href="importing/launchdarkly">
            <a>LaunchDarkly</a>
          </Link>
        </li>
      </ul>
    </div>
  );
};
