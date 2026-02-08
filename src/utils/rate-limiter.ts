/**
 * Rate limiting utilities.
 */

export function delay(minSec: number, maxSec: number): Promise<void> {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
