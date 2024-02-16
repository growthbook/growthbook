import React from "react";
// eslint-disable-next-line import/no-unresolved
import Details from '@theme/MDXComponents/Details';

export default function Collapse (props: { children: React.ReactNode; title?: string }) {
    const { children, title = "Collapse" } = props;

    return (
        <Details>
            <summary mdxType="summary"><b>{title}</b></summary>
            {children}
        </Details>
    );
}