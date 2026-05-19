"""Match observed attributes to :class:`~gbstats.models.results.ContextualBanditResponse` entries and read weights."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Optional

from gbstats.models.results import ContextualBanditResponse


class ContextualBanditWeightsLookup:
    """Match ``ContextualBanditResponse.context`` conditions to observed attributes and return ``updatedWeights``."""

    @staticmethod
    def _clause_matches(actual: Any, spec: Any) -> bool:
        if isinstance(spec, dict) and "$in" in spec:
            allowed = spec["$in"]
            if not isinstance(allowed, (list, tuple, set)):
                return False
            return actual in allowed
        if isinstance(spec, dict) and "$nin" in spec:
            forbidden = spec["$nin"]
            if not isinstance(forbidden, (list, tuple, set)):
                return False
            return actual not in forbidden
        return actual == spec

    @staticmethod
    def attributes_match_condition(
        observed: Mapping[str, Any], condition: dict[str, Any]
    ) -> bool:
        """True if every key in ``condition`` is present in ``observed`` and the clause matches."""
        if not condition:
            return True
        for key, spec in condition.items():
            if key not in observed:
                return False
            if not ContextualBanditWeightsLookup._clause_matches(observed[key], spec):
                return False
        return True

    @staticmethod
    def observed_from_tuple(
        attributes: Sequence[str], context_tuple: tuple[str, ...]
    ) -> dict[str, str]:
        """Zip SQL-style context tuple with attribute names (same order as bandit ``attributes``)."""
        if len(attributes) != len(context_tuple):
            raise ValueError(
                f"attributes length {len(attributes)} != context tuple length {len(context_tuple)}"
            )
        return {str(a): str(v) for a, v in zip(attributes, context_tuple)}

    @staticmethod
    def find_matching_contextual_response(
        responses: Sequence[ContextualBanditResponse],
        observed: Mapping[str, Any],
    ) -> Optional[ContextualBanditResponse]:
        """First response whose ``context`` (condition) matches ``observed``."""
        for r in responses:
            if ContextualBanditWeightsLookup.attributes_match_condition(
                observed, r.context
            ):
                return r
        return None

    @staticmethod
    def weights_for_observed_attributes(
        responses: Sequence[ContextualBanditResponse],
        observed: Mapping[str, Any],
    ) -> list[float]:
        """Return ``updatedWeights`` from the first matching response; raise if none or weights missing."""
        r = ContextualBanditWeightsLookup.find_matching_contextual_response(
            responses, observed
        )
        if r is None:
            raise KeyError(
                f"No ContextualBanditResponse matched observed={dict(observed)!r}"
            )
        w = r.updatedWeights
        if w is None:
            raise ValueError(
                "Matching ContextualBanditResponse has updatedWeights=None"
            )
        return [float(x) for x in w]

    @staticmethod
    def weights_for_context_tuple(
        responses: Sequence[ContextualBanditResponse],
        attributes: Sequence[str],
        context_tuple: tuple[str, ...],
    ) -> list[float]:
        """Map ``context_tuple`` to a dict, then :meth:`weights_for_observed_attributes`."""
        observed = ContextualBanditWeightsLookup.observed_from_tuple(
            attributes, context_tuple
        )
        return ContextualBanditWeightsLookup.weights_for_observed_attributes(
            responses, observed
        )
