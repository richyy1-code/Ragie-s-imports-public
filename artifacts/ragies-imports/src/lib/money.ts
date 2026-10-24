// Payments are settled in pesewas. Whole-cedi rounding can make a deposit
// appear equal to the full order value, and conceal an outstanding balance.
export const money = (amount: number, currency = 'GHS') =>
  new Intl.NumberFormat('en-GH', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
