/**
 * Display rule helpers for SMPL measurements.
 *
 * When a custom measurement differs from the SMPL-extracted value by more
 * than 3 cm, the displayed value should be the SMPL-extracted value
 * (reflecting the actual mesh shape) rather than the user-entered value.
 *
 * BMI is always computed from height/weight inputs, never extracted from mesh.
 */

/**
 * Resolve which measurement value to display.
 *
 * @param custom   - User-entered custom measurement (null if not provided)
 * @param estimated - The estimated/computed measurement (from estimatedMeasurements)
 * @param smplExtracted - The raw SMPL-extracted measurement (null if SMPL not active)
 * @returns The value to display
 */
export function resolveDisplayMeasurement(
  custom: number | null,
  estimated: number,
  smplExtracted: number | null,
): number {
  if (smplExtracted != null && custom != null && Math.abs(custom - smplExtracted) > 3) {
    return Math.round(smplExtracted);
  }
  return estimated;
}
