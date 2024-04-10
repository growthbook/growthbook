from abc import ABC, abstractmethod
from typing import Dict, Mapping, Tuple, Type

import numpy as np

from gbstats.models.statistics import TestStatistic
from gbstats.models.tests import BaseABTest, BaseConfig

##############################################
# this file is used for internal testing only.
# no methods from this file should be exported.
###############################################


class SimulationStudy(ABC):
    def __init__(
        self,
        test_dict: Mapping[str, Tuple[Type[BaseABTest], BaseConfig]],
        data_params: Dict,
        seed: int,
        n_sim: int = 100,
        alpha: float = 0.05,
    ):
        self.n_sim = n_sim
        self.alpha = alpha
        self.seed = seed
        self.test_names = list(test_dict.keys())
        self.tests = list([v[0] for v in test_dict.values()])
        self.configs = list([v[1] for v in test_dict.values()])
        self.data_params = data_params
        self.create_storage_arrays()

    def run_sim(self):
        for i in range(self.n_sim):
            self.run_iteration(i)

    def run_iteration(self, i):
        np.random.seed(self.seed + i)
        stat_a, stat_b, estimand = self.generate_data()
        for j, test in enumerate(self.tests):
            t = test(stat_a, stat_b, self.configs[j])
            test_result = t.compute_result()
            self.pt[i, j] = test_result.expected
            self.se[i, j] = test_result.uplift.stddev
            self.lower_limit[i, j] = test_result.ci[0]
            self.upper_limit[i, j] = test_result.ci[1]
            self.theta[i, j] = estimand
            self.results[i, j] = test_result

    def create_storage_arrays(self):
        array_shape = (self.n_sim, len(self.tests))
        self.pt = np.empty(array_shape)
        self.se = np.empty(array_shape)
        self.theta = np.empty(array_shape)
        self.lower_limit = np.empty(array_shape)
        self.upper_limit = np.empty(array_shape)
        self.results = np.empty(array_shape, dtype=object)

    @abstractmethod
    def generate_data(self) -> Tuple[TestStatistic, TestStatistic, float]:
        pass

    @property
    def coverage(self):
        """computes coverage."""
        return [
            np.mean(
                (self.lower_limit[:, j] <= self.theta[:, j])
                * (self.upper_limit[:, j] >= self.theta[:, j])
            )
            for j in range(len(self.tests))
        ]

    @property
    def reject(self):
        return [
            1.0
            - np.mean((self.lower_limit[:, j] < 0.0) * (self.upper_limit[:, j] > 0.0))
            for j in range(len(self.tests))
        ]

    @property
    def mse(self):
        return [
            np.mean((self.pt[:, j] - self.theta[:, j]) ** 2)
            for j in range(len(self.tests))
        ]

    @property
    def bias(self):
        return [
            np.mean(self.pt[:, j] - self.theta[:, j]) for j in range(len(self.tests))
        ]

    @property
    def variance(self):
        return [np.var(self.pt[:, j]) for j in range(len(self.tests))]
