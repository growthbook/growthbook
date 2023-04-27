import importlib.metadata

import packaging.version


def check_gbstats_compatibility(nb_version: str) -> None:
    gbstats_version = importlib.metadata.version("gbstats")
    if packaging.version.parse(nb_version) > packaging.version.parse(gbstats_version):
        raise ValueError(
            f"""Current gbstats version: {gbstats_version}. {nb_version} or later is needed.
                Use `pip install gbstats=={nb_version}` to install the needed version."""
        )
