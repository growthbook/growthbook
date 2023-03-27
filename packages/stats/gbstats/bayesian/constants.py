from dataclasses import dataclass

from gbstats.shared.constants import BaseConfig


@dataclass
class BetaPrior:
    a: float = 1
    b: float = 1


@dataclass
class NormalPrior:
    mean: float = 0
    variance: float = 1
    pseudousers: float = 0


@dataclass
class BayesianConfig(BaseConfig):
    beta_prior: BetaPrior = BetaPrior()
    normal_prior: NormalPrior = NormalPrior()
    epsilon: float = 1e-04
