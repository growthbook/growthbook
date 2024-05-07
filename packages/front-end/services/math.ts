/**
 * Given a float value multiplier that represents a percentage, e.g. 0.5,
 * returns the human-readable version, i.e. 50
 * See the inverse:
 *    @link transformHumanReadablePercentageToFloatMultiplier
 * @param value
 * @param fractionDigits
 */
export const transformFloatMultiplierToHumanReadablePercentage = (
  value: number,
  fractionDigits = 2,
): number => +(value * 100).toFixed(fractionDigits);

/**
 * Given a human-readable percentage, e.g. 50,
 * returns the float value multiplier version, i.e. 0.5
 *
 * See the inverse:
 *    @link transformFloatMultiplierToHumanReadablePercentage
 *
 * @param value
 * @param fractionDigits
 */
export const transformHumanReadablePercentageToFloatMultiplier = (
  value: number,
  fractionDigits = 4,
): number => +(value / 100).toFixed(fractionDigits);
