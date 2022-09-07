interface ParamsRowProps {
  name?: string;
  required?: boolean;
  type: string;
  description?: string;
  hr: boolean;
  href?: string;
  hrefName?: string;
  defaultValueHTML?: string;
}

export default function ParamsRow({
  name = "",
  required = true,
  type,
  description,
  hr = true,
  href,
  hrefName = "view docs",
  defaultValueHTML,
}: ParamsRowProps) {
  return (
    <div className="w-full">
      {hr && <hr style={{ margin: "1rem 0 1rem" }} />}
      <div className="flex justify-between">
        <div>
          {name} <strong>{required ? "required" : "(optional)"}</strong>
          {href && (
            <span>
              {` `}
              <a href={href} target="_blank" rel="noreferrer">
                ({hrefName})
              </a>
            </span>
          )}
          <div>
            <code>{type}</code>
            {description && `: ${description}`}
          </div>
        </div>
        {defaultValueHTML && (
          <div>
            <pre className="my-0 py-1" style={{ margin: "0" }}>
              <code dangerouslySetInnerHTML={{ __html: defaultValueHTML }} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
