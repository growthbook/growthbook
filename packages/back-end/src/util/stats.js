"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.powerEst = exports.meanVarianceFromSums = exports.sumSquaresFromStats = exports.checkSrm = void 0;
var chisquare_1 = require("@stdlib/stats/base/dists/chisquare");
var normal_1 = require("@stdlib/stats/base/dists/normal");
function checkSrm(users, weights) {
    // Skip variations with weight=0 or users=0
    var data = [];
    var totalUsers = 0;
    var totalWeight = 0;
    for (var i = 0; i < weights.length; i++) {
        if (!weights[i] || !users[i])
            continue;
        data.push([users[i], weights[i]]);
        totalUsers += users[i];
        totalWeight += weights[i];
    }
    // Skip SRM calculation if there aren't enough valid variations
    if (data.length < 2) {
        return 1;
    }
    // Calculate and return SRM p-value using a ChiSquare test
    var x = 0;
    data.forEach(function (_a) {
        var o = _a[0], e = _a[1];
        e = (e / totalWeight) * totalUsers;
        x += Math.pow(o - e, 2) / e;
    });
    return 1 - chisquare_1.default.cdf(x, data.length - 1);
}
exports.checkSrm = checkSrm;
function returnZeroIfNotFinite(x) {
    if (isFinite(x)) {
        return x;
    }
    return 0;
}
function sumSquaresFromStats(sum, variance, n) {
    return returnZeroIfNotFinite(variance * (n - 1) + Math.pow(sum, 2) / n);
}
exports.sumSquaresFromStats = sumSquaresFromStats;
function meanVarianceFromSums(sum, sum_squares, n) {
    var variance = (sum_squares - Math.pow(sum, 2) / n) / (n - 1);
    return returnZeroIfNotFinite(variance);
}
exports.meanVarianceFromSums = meanVarianceFromSums;
/**
 * Performs power calculation
 *
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param n_variations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
function powerEst(effectSize, mean, variance, n, n_variations, alpha, twoTailed) {
    if (alpha === void 0) { alpha = 0.05; }
    if (twoTailed === void 0) { twoTailed = true; }
    if (typeof twoTailed !== "boolean") {
        throw new Error("twoTailed must be boolean.");
    }
    var zStar = twoTailed
        ? normal_1.default.quantile(1.0 - 0.5 * alpha, 0, 1)
        : normal_1.default.quantile(1.0 - alpha, 0, 1);
    var standardError = Math.sqrt(2 * variance * n_variations / n);
    var standardizedEffectSize = effectSize * mean / standardError;
    var upperCutpoint = zStar - standardizedEffectSize;
    var power = 1 - normal_1.default.cdf(upperCutpoint, 0, 1);
    if (twoTailed) {
        var lowerCutpoint = -zStar - standardizedEffectSize;
        power += normal_1.default.cdf(lowerCutpoint, 0, 1);
    }
    return power;
}
exports.powerEst = powerEst;
