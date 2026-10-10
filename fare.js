// Must match baseFare() and validRideFare() in firestore.rules.
export const BASE_FARES = { bike: 55, auto: 95, cab: 250, parcel: 75 };
export const COUPONS = { SOUTH50: 25, ARIDE50: 25 };
export const MAX_TIP = 500;

export function fareFor(vehicleType, couponCode = '') {
  const base = BASE_FARES[vehicleType];
  if (!base) return null;
  if (!couponCode) return base;
  const discount = COUPONS[couponCode];
  return discount ? base - discount : null;
}
