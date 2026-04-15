"""Sequential Sample Ratio Mismatch (SSRM) detection.

Implements a sequential Bayes factor test for detecting sample ratio mismatch
in A/B experiments. The test compares two models at each time step:

  M0 (null): Observations follow Multinomial(n, p0) with fixed null probabilities.
  M1 (alt):  Observations follow a Multinomial whose proportions are drawn from
             a Dirichlet prior (or a spike-and-slab mixture of Dirichlets).

The Bayes factor BF = p(data | M1) / p(data | M0) is accumulated sequentially.
An anytime-valid p-value is obtained as the running minimum of 1/BF across all
time steps, following the e-value / test-martingale approach.

The Dirichlet-Multinomial marginal likelihood is the standard conjugate result:
  p(x | alpha) = [n! / prod(x_i!)] * [B(alpha + x) / B(alpha)]
where B is the multivariate Beta function expressed via log-gamma.

References:
  - Howard, Ramdas, McAuliffe, Sekhon (2021). "Time-uniform, nonparametric,
    nonasymptotic confidence sequences." Annals of Statistics.
  - Lindon, Semmens, Gotwalt (2022). "Anytime-valid sequential testing for
    sample ratio mismatch."
"""

from __future__ import annotations

from typing import TYPE_CHECKING, List, Optional

import numpy as np
from scipy.special import gammaln, logsumexp, xlogy

if TYPE_CHECKING:
    from gbstats.models.settings import AnalysisSettingsForStatsEngine


def _log_dirichlet_multinomial(x: np.ndarray, alpha: np.ndarray) -> float:
    """Log marginal likelihood of observation x under a Dirichlet(alpha) prior.

    This is the Dirichlet-Multinomial (Polya) distribution:
      log p(x | alpha) = log Gamma(sum x + 1) - sum log Gamma(x_i + 1)
                        + log Gamma(sum alpha) - sum log Gamma(alpha_i)
                        + sum log Gamma(alpha_i + x_i) - log Gamma(sum alpha + sum x)
    """
    n = x.sum()
    sum_alpha = alpha.sum()
    return float(
        gammaln(n + 1)
        - gammaln(x + 1).sum()
        + gammaln(sum_alpha)
        - gammaln(alpha).sum()
        + gammaln(alpha + x).sum()
        - gammaln(sum_alpha + n)
    )


def _log_multinomial_pmf(x: np.ndarray, p: np.ndarray) -> float:
    """Log PMF of Multinomial(sum(x), p) evaluated at x."""
    n = x.sum()
    return float(gammaln(n + 1) + np.sum(xlogy(x, p) - gammaln(x + 1)))


def _validate_integer_data(data: np.ndarray) -> bool:
    """Check that all elements are non-negative integers."""
    return bool(np.all(data == np.floor(data)) and np.all(data >= 0))


class _SequentialState:
    """Internal accumulator for the sequential Bayes factor computation."""

    __slots__ = (
        "log_ml_m1",
        "log_ml_m0",
        "null_probs",
        "spike_alpha",
        "slab_alpha",
        "slab_weight",
    )

    def __init__(
        self,
        null_probs: np.ndarray,
        spike_alpha: np.ndarray,
        slab_alpha: Optional[np.ndarray],
        slab_weight: float,
    ):
        self.log_ml_m1: float = 0.0
        self.log_ml_m0: float = 0.0
        self.null_probs = null_probs
        self.spike_alpha = spike_alpha.copy()
        self.slab_alpha = slab_alpha.copy() if slab_alpha is not None else None
        self.slab_weight = slab_weight

    @property
    def log_bayes_factor(self) -> float:
        return self.log_ml_m1 - self.log_ml_m0

    def update(self, x: np.ndarray) -> None:
        """Incorporate one time-step of count data."""
        row_total = x.sum()

        # M0: fixed multinomial
        if row_total > 0:
            self.log_ml_m0 += _log_multinomial_pmf(x, self.null_probs)

        # M1: Dirichlet-Multinomial (possibly mixture)
        if self.slab_alpha is not None and self.slab_weight > 0.0:
            log_ml_spike = _log_dirichlet_multinomial(x, self.spike_alpha)
            log_ml_slab = _log_dirichlet_multinomial(x, self.slab_alpha)

            w = self.slab_weight
            if w == 1.0:
                log_ml_step = log_ml_slab
            elif w == 0.0:
                log_ml_step = log_ml_spike
            else:
                log_ml_step = float(
                    logsumexp(  # type: ignore[arg-type]
                        [np.log(1 - w) + log_ml_spike, np.log(w) + log_ml_slab]
                    )
                )

            self.slab_alpha = self.slab_alpha + x
        else:
            log_ml_step = _log_dirichlet_multinomial(x, self.spike_alpha)

        self.log_ml_m1 += log_ml_step
        self.spike_alpha = self.spike_alpha + x


def _build_initial_state(
    null_probabilities: np.ndarray,
    dirichlet_probability: Optional[np.ndarray],
    dirichlet_concentration: float,
    slab_weight: float,
    slab_concentration: float,
) -> _SequentialState:
    """Construct the initial accumulator state from prior parameters."""
    if not (0.0 <= slab_weight <= 1.0):
        raise ValueError(f"slab_weight must be in [0, 1], got {slab_weight}")

    prior_mean = (
        dirichlet_probability
        if dirichlet_probability is not None
        else null_probabilities
    )
    spike_alpha = prior_mean * dirichlet_concentration

    slab_alpha: Optional[np.ndarray] = None
    if slab_weight > 0.0:
        k = len(null_probabilities)
        slab_alpha = np.ones(k) * slab_concentration

    return _SequentialState(
        null_probs=null_probabilities,
        spike_alpha=spike_alpha,
        slab_alpha=slab_alpha,
        slab_weight=slab_weight,
    )


def sequential_p_values(
    data: np.ndarray,
    null_probabilities: np.ndarray,
    dirichlet_probability: Optional[np.ndarray] = None,
    dirichlet_concentration: float = 10000.0,
    slab_weight: float = 0.0,
    slab_concentration: float = 1.0,
) -> List[float]:
    """Compute anytime-valid sequential p-values for SRM detection.

    The p-value at step t is min(1, min_{s<=t} 1/BF_s), i.e. the running
    minimum of the reciprocal Bayes factor. This is a valid sequential
    p-value: if no SRM exists, P(p_t <= alpha) <= alpha for all t simultaneously.

    Parameters
    ----------
    data:
        2-D integer array, shape (T, K). Row t contains the number of new users
        assigned to each of K variations during time period t.
    null_probabilities:
        Expected traffic allocation fractions, length K, summing to 1.
    dirichlet_probability:
        Mean of the Dirichlet prior under M1. Defaults to null_probabilities.
    dirichlet_concentration:
        Concentration of the spike (informative) Dirichlet prior. Higher values
        concentrate the prior more tightly around its mean. Default 10000.
    slab_weight:
        Mixture weight for the slab (diffuse) component, in [0, 1]. When 0
        (default), only the spike component is used.
    slab_concentration:
        Concentration parameter for the slab Dirichlet. Default 1.0 (uniform).

    Returns
    -------
    List of T p-values, one per time period.
    """
    data = np.asarray(data)
    if data.size == 0:
        return []
    if not _validate_integer_data(data):
        raise TypeError("Data is supposed to be an array of integer arrays")

    null_probabilities = np.asarray(null_probabilities)
    state = _build_initial_state(
        null_probabilities,
        dirichlet_probability,
        dirichlet_concentration,
        slab_weight,
        slab_concentration,
    )

    p_values: List[float] = []
    running_min = 1.0

    for row in data:
        state.update(row)
        bf = np.exp(state.log_bayes_factor)
        inv_bf = 1.0 / bf if bf > 0 else float("inf")
        running_min = min(running_min, inv_bf)
        p_values.append(running_min)

    return p_values


def compute_srm_p_value(
    analysis: "AnalysisSettingsForStatsEngine",
    daily_users: List[List[int]],
    num_variations: int,
) -> float:
    """Compute the SRM p-value for an experiment analysis.

    Dispatches to sequential_p_values() when analysis.srm_method == "sequential",
    otherwise delegates to check_srm() (chi-squared).

    Parameters
    ----------
    analysis:
        Analysis settings containing weights, srm_method, and prior params.
    daily_users:
        2-D list of daily user counts per variation. Each inner list has one
        entry per variation for that day.
    num_variations:
        Number of experiment variations (used for fallback aggregation).
    """
    from gbstats.utils import check_srm

    if analysis.srm_method == "sequential":
        total_weight = sum(analysis.weights)
        valid_indices = [i for i, w in enumerate(analysis.weights) if w > 0]
        null_probs = [analysis.weights[i] / total_weight for i in valid_indices]
        filtered = [[row[i] for i in valid_indices] for row in daily_users]
        if not any(sum(row) for row in filtered):
            return 1.0
        p_vals = sequential_p_values(
            np.array(filtered),
            np.array(null_probs),
            slab_weight=analysis.srm_slab_weight,
            dirichlet_concentration=analysis.srm_dirichlet_concentration,
        )
        return float(p_vals[-1])

    # Chi-squared: aggregate daily rows to totals
    users = [sum(row[i] for row in daily_users) for i in range(len(analysis.weights))]
    return check_srm(users, analysis.weights)
