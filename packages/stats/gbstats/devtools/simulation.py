import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm
from typing import cast

##############################################
# this file is used for internal testing only.
# no methods from this file should be exported.
###############################################
# Doesnt it seem like you should pass in some estimator class
# that always returns a point estimate and a standard error,
# and more or less everything else is handled by this simulation engine?

# You basically need to have fixed interfaces across classes
# (input: Statistic output: se and mean ). Which we kind of have.


@dataclass
class Estimator:
    n_sim: int
    alpha: float = 0.05

    def create_arrays(self):
        array_shape = (self.n_sim,)
        self.pt = np.empty(array_shape)
        self.se = np.empty(array_shape)
        self.theta = np.empty(array_shape)

    @property
    def multiplier(self):
        return norm.ppf(1.0 - 0.5 * self.alpha, loc=0, scale=1)

    @property
    def lower_limit(self) -> np.ndarray:
        return self.pt - self.se * self.multiplier

    @property
    def upper_limit(self) -> np.ndarray:
        return self.pt + self.se * self.multiplier

    @property
    def coverage(self) -> float:
        """computes coverage."""
        return cast(
            float,
            np.mean(
                (self.lower_limit <= self.theta) * (self.upper_limit >= self.theta)
            ),
        )

    @property
    def reject(self):
        zero_in_interval = (self.lower_limit < 0.0) * (self.upper_limit > 0.0)
        return 1.0 - np.mean(zero_in_interval)

    @property
    def mse(self):
        return np.mean((self.pt - self.theta) ** 2, axis=0)

    @property
    def bias(self):
        return np.mean(self.pt - self.theta)

    @property
    def variance(self):
        return np.var(self.pt)


@dataclass
class SimulationStudy:
    n_sim: int = 100
    alpha: float = 0.05
    seed: int = 20240401

    def run_sim(self):
        self.create_storage_arrays()
        self.run_all_iterations()

    def run_all_iterations(self):
        for i in range(self.n_sim):
            self.run_iteration(i)

    def run_iteration(self, i):
        np.random.seed(self.seed + i)
        self.generate_data()

    def create_storage_arrays(self):
        pass

    def generate_data(self):
        pass

    def get_standard_error_from_interval(self, lower, upper):
        return (upper - lower) / (2 * self.multiplier)

    @property
    def multiplier(self):
        return norm.ppf(1.0 - 0.5 * self.alpha, loc=0, scale=1)
