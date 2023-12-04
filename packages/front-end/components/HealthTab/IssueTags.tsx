interface Props {
  issues: string[];
}

export const IssueTags = ({ issues }: Props) => {
  if (!issues.length) {
    return <h4 className="mt-2 mb-4">No issues found. 🎉</h4>;
  }

  return (
    <div className="d-flex align-items-sm-center">
      <h4>Jump to issues found: </h4>
      {issues.map((issue) => {
        return (
          <a
            className={"badge badge-pill border ml-2 mr-2 badge-warning"}
            key={issue}
            href={`#${issue}`}
          >
            {issue}
          </a>
        );
      })}
    </div>
  );
};
