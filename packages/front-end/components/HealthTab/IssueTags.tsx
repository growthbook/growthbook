export type IssueValue = {
  label: string;
  value: string;
};

interface Props {
  issues: IssueValue[];
}

export const IssueTags = ({ issues }: Props) => {
  if (!issues?.length) {
    return <h4 className="mt-2 mb-4">未发现问题. 🎉</h4>;
  }

  return (
    <div className="d-flex flex-row">
      <h4 className="col-auto pl-0 mb-0">跳转到发现的问题: </h4>
      <div className="flex-wrap">
        {issues.map((issue) => {
          return (
            <a
              className={"badge badge-pill border mx-2 badge-warning"}
              key={issue.value}
              href={`#${issue.value}`}
              style={{ marginBottom: "12px" }}
            >
              {issue.label}
            </a>
          );
        })}
      </div>
    </div>
  );
};
