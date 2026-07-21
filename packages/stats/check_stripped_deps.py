#!/usr/bin/env python3
"""Build-time guard for the production Docker image (see ../../Dockerfile).

The image deliberately ships gbstats with a minimal runtime venv: the dev group
is never installed, and poetry's build-time footprint (poetry, keyring and its
credential-store backend, setuptools, wheel, dulwich, ...) is stripped after the
build. This script fails the build if either assumption stops holding:

  1. Every gbstats submodule must still import using only the runtime deps. If a
     future change makes gbstats depend on a stripped distribution, the import
     fails here instead of breaking at runtime.
  2. The stripped distributions must stay absent from the venv. If a dependency
     change quietly pulls one back in, the build fails so the reintroduced
     package and its CVE surface get re-evaluated rather than silently shipped.

This is expected to fail in a normal dev environment, where the dev group and the
poetry footprint are installed — it only passes against the stripped runtime venv.
"""

import importlib
import importlib.metadata
import pkgutil
import sys

# Distributions stripped from the runtime image — the single source of truth. The
# Dockerfile's `pip uninstall` line generates its arguments from this list, and the
# guard below asserts they ended up absent, so the two can't drift apart.
# cryptography, SecretStorage and jeepney are poetry's keyring footprint
# (poetry -> keyring -> SecretStorage -> cryptography), not gbstats runtime deps.
STRIPPED = [
    "cryptography",
    "SecretStorage",
    "jeepney",
    "poetry",
    "poetry-core",
    "poetry-plugin-export",
    "keyring",
    "jaraco.classes",
    "setuptools",
    "wheel",
    "dulwich",
]


def is_installed(distribution: str) -> bool:
    try:
        importlib.metadata.distribution(distribution)
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


def main() -> None:
    import gbstats

    for mod in pkgutil.walk_packages(gbstats.__path__, "gbstats."):
        importlib.import_module(mod.name)

    leaked = [dist for dist in STRIPPED if is_installed(dist)]
    if leaked:
        sys.exit(
            f"ERROR: distribution(s) expected to be absent from the runtime venv: {leaked}"
        )


if __name__ == "__main__":
    main()
