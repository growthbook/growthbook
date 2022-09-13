import Link from "next/link";

interface DocsLinkProps {
  href: string;
  name: string;
  beta: boolean;
  auth: boolean;
  active: boolean;
}

export default function DocsLink({
  href,
  name,
  beta,
  auth,
  active,
}: DocsLinkProps) {
  return (
    <Link href={href}>
      <div
        className={`flex cursor-pointer justify-between rounded py-1 mb-1 px-2 text-sm ${
          active
            ? "bg-gray-200 dark:bg-gray-600 font-bold"
            : "hover:bg-gray-100 dark:hover:bg-gray-700"
        }`}
      >
        <a className="block whitespace-nowrap">
          {name}
          {beta ? (
            <span className="bg-yellow-400 dark:bg-yellow-600 p-1 rounded text-xs ml-1">
              beta
            </span>
          ) : (
            ""
          )}
          {auth ? (
            <span className="bg-green-400 dark:bg-green-600 p-1 rounded text-xs ml-1">
              auth
            </span>
          ) : (
            ""
          )}
        </a>
      </div>
    </Link>
  );
}
