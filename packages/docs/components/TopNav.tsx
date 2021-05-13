import * as React from "react";
import Link from "next/link";

export default function TopNav() {
  return (
    <nav className="navbar navbar-expand-lg navbar-light border-bottom bg-light mb-3">
      <Link href="/">
        <a className="navbar-brand">
          <img
            src="/growth-book-logo.png"
            alt="Growth Book"
            style={{ verticalAlign: "middle", marginRight: "10px", height: 40 }}
          />
          <span className="text-muted" style={{ verticalAlign: "bottom" }}>
            Docs
          </span>
        </a>
      </Link>
    </nav>
  );
}
