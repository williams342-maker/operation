/**
 * Client-side shipping rate estimator.
 *
 * Approximates 2026 USPS Ground Advantage + UPS Ground rates from public
 * rate tables. NOT a substitute for a real carrier API at checkout — this
 * is a "ballpark for the maker while they fill in the listing" preview so
 * they can sanity-check whether their flat $25 fee is leaving money on
 * the table or scaring buyers away.
 *
 * The maker fills in:
 *   - weight (lb + oz)
 *   - packed dimensions (L × W × H, inches)
 *
 * We compute:
 *   - actual weight in pounds
 *   - dimensional weight = (L × W × H) / 166  (industry standard divisor)
 *   - billable weight = max(actual, dim)  (carriers charge the larger)
 *
 * Then look up the rate for that billable weight against zone-4 USPS
 * Ground Advantage and UPS Ground tables (zone 4 ≈ middle-of-country
 * average — closest single-zone approximation to a 3000-mile-wide
 * marketplace).
 *
 * Returns up to 3 carrier/service combos sorted by cost ascending so the
 * cheapest option is always first.
 */

// USPS Ground Advantage zone-4 rate table (lb → $). Approximates the
// 2026 published rates for retail; commercial rates run ~10% lower but
// most makers don't qualify on small volume.
const USPS_GROUND_ZONE4 = [
  [1, 8.25], [2, 9.95], [3, 11.20], [4, 12.85], [5, 14.40],
  [6, 15.70], [7, 17.10], [8, 18.40], [9, 19.80], [10, 21.30],
  [15, 27.50], [20, 33.80], [30, 47.20], [50, 76.40], [70, 105.00],
];

// UPS Ground zone-4 retail. Generally a bit higher than USPS for
// sub-10lb but cheaper on heavy/oversized.
const UPS_GROUND_ZONE4 = [
  [1, 12.30], [2, 13.20], [3, 14.40], [4, 15.85], [5, 17.30],
  [6, 18.85], [7, 20.40], [8, 22.10], [9, 23.85], [10, 25.60],
  [15, 31.20], [20, 36.80], [30, 47.90], [50, 71.20], [70, 96.50],
];

// USPS Priority Mail flat-rate cube — fits up to 12×12×6 (864 cu·in)
// or 70 lb. Treat as a single cap-rate.
const PRIORITY_FLAT = { service: "Priority Flat-Rate Box", cost: 22.40, days: "2-3", maxCuIn: 864, maxLb: 70 };

const lookup = (table, lbs) => {
  // Find the smallest tier ≥ lbs; clamp at the top of the table.
  const last = table[table.length - 1];
  if (lbs >= last[0]) return last[1];
  for (const [tier, rate] of table) {
    if (lbs <= tier) return rate;
  }
  return last[1];
};

export function estimateShipping({
  weight_lbs = 0,
  weight_oz = 0,
  packed_length_in = 0,
  packed_width_in = 0,
  packed_height_in = 0,
}) {
  const wLb = Number(weight_lbs) || 0;
  const wOz = Number(weight_oz) || 0;
  const L = Number(packed_length_in) || 0;
  const W = Number(packed_width_in) || 0;
  const H = Number(packed_height_in) || 0;

  // Need at least weight or dimensions to estimate.
  const actualLb = wLb + wOz / 16;
  const cuIn = L * W * H;
  if (actualLb <= 0 && cuIn <= 0) return null;

  const dimLb = cuIn / 166;
  const billableLb = Math.max(actualLb, dimLb, 0.1);   // floor at 0.1 to avoid free shipping
  const billableLbCeil = Math.ceil(billableLb);          // carriers round up

  const out = [
    {
      carrier: "USPS",
      service: "Ground Advantage",
      cost: lookup(USPS_GROUND_ZONE4, billableLbCeil),
      days: "3-5",
      note: billableLb > actualLb ? "dim-weight applied" : null,
    },
    {
      carrier: "UPS",
      service: "Ground",
      cost: lookup(UPS_GROUND_ZONE4, billableLbCeil),
      days: "3-5",
      note: billableLb > actualLb ? "dim-weight applied" : null,
    },
  ];

  // Priority Flat-Rate is only competitive for small/heavy items that
  // fit in the box and weigh enough that ground rates exceed flat.
  if (cuIn > 0 && cuIn <= PRIORITY_FLAT.maxCuIn && actualLb <= PRIORITY_FLAT.maxLb) {
    out.push({
      carrier: "USPS",
      service: PRIORITY_FLAT.service,
      cost: PRIORITY_FLAT.cost,
      days: PRIORITY_FLAT.days,
      note: "fits flat-rate box",
    });
  }

  out.sort((a, b) => a.cost - b.cost);
  return {
    actualLb: actualLb.toFixed(2),
    dimLb: dimLb.toFixed(2),
    billableLb: billableLb.toFixed(2),
    options: out.slice(0, 3),
  };
}
