// ============================================================
// Stripe Tax — destination-based US sales tax via the Tax Calculations API.
//
// OFF BY DEFAULT. Nothing here runs unless STRIPE_TAX=on. When disabled (or if a
// calculation fails) the helpers return null so callers fall back to the legacy
// flat rate and checkout never breaks.
//
// Before enabling: in the Stripe dashboard turn on Stripe Tax AND add a tax
// registration for every state where you have nexus. Without a registration,
// Stripe returns $0 tax for that state — which is the correct compliant
// behavior (you only collect where you're registered). See TAX-SETUP.md.
// ============================================================
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const STRIPE_TAX_ENABLED = process.env.STRIPE_TAX === 'on';

// Default: "General - Tangible Goods". Apparel is taxed differently in some
// states (e.g. PA, NJ, MN exempt most clothing). If you sell into those states
// set STRIPE_TAX_CODE to a clothing-specific code. https://stripe.com/docs/tax/tax-codes
const TAX_CODE = process.env.STRIPE_TAX_CODE || 'txcd_99999999';

// items: [{ id, price, qty }]   shippingCents: integer
// address: { line1?, city?, state, postal_code }  (US only)
// → { taxCents, totalCents, calculationId }  or null (caller falls back)
export async function calculateTax({ items, shippingCents, address }) {
  if (!STRIPE_TAX_ENABLED) return null;
  // Stripe Tax needs at least a state + ZIP to locate the destination.
  if (!address?.postal_code || !address?.state) return null;
  try {
    const calc = await stripe.tax.calculations.create({
      currency: 'usd',
      line_items: items.map(it => ({
        amount: Math.round(it.price * it.qty * 100),  // line total, in cents
        reference: String(it.id),
        quantity: it.qty,
        tax_behavior: 'exclusive',                     // tax added on top of price
        tax_code: TAX_CODE
      })),
      shipping_cost: { amount: shippingCents, tax_behavior: 'exclusive' },
      customer_details: {
        address: {
          line1: address.line1 || undefined,
          city: address.city || undefined,
          state: address.state,
          postal_code: address.postal_code,
          country: 'US'
        },
        address_source: 'shipping'
      }
    });
    return {
      taxCents: calc.tax_amount_exclusive,
      totalCents: calc.amount_total,
      calculationId: calc.id
    };
  } catch (err) {
    console.error('Stripe Tax calculation failed:', err.message);
    return null;  // fall back to the legacy flat rate
  }
}

// Record a completed calculation as a Tax Transaction so it appears in Stripe
// Tax reporting/filing. Called from the webhook once payment succeeds. Tied to
// the idempotent order claim so webhook retries don't double-record.
export async function recordTaxTransaction(calculationId, orderId) {
  if (!STRIPE_TAX_ENABLED || !calculationId) return;
  try {
    await stripe.tax.transactions.createFromCalculation({
      calculation: calculationId,
      reference: String(orderId)
    });
  } catch (err) {
    console.error('Stripe Tax transaction record failed:', err.message);
  }
}
