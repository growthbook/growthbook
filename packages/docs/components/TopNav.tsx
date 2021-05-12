import * as React from "react";
import Link from "next/link";

export default function TopNav() {
  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark mb-3">
      <Link href="/">
        <a className="navbar-brand">
          <img
            src="/growth-book-logo.png"
            alt="Growth Book"
            style={{ verticalAlign: "middle", marginRight: "10px", height: 40 }}
          />
          <span style={{ verticalAlign: "bottom" }}>Docs</span>
        </a>
      </Link>
    </nav>
  );
}
