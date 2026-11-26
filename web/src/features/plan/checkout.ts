/** Razorpay Checkout (UPI, cards, wallets). Amount is fixed by our server. */
import { api } from '../../lib/api';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill?: { email?: string };
  theme?: { color: string };
  handler(r: RazorpayResponse): void;
  modal?: { ondismiss(): void };
}

declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => { open(): void; on(ev: 'payment.failed', cb: () => void): void };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('checkout script failed'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type CheckoutResult = 'paid' | 'cancelled' | 'failed';

export async function buyPlan(
  planId: string,
  householdId: string,
  appName: string,
  email?: string,
): Promise<CheckoutResult> {
  const [order] = await Promise.all([api.createOrder(planId, householdId), loadScript()]);
  const Razorpay = window.Razorpay;
  if (!Razorpay) return 'failed';
  return new Promise<CheckoutResult>((resolve) => {
    const rzp = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_paise,
      currency: 'INR',
      name: appName,
      description: order.name,
      prefill: email ? { email } : undefined,
      theme: { color: '#0f766e' },
      handler: (r) => {
        api
          .verifyPayment(r)
          .then(() => resolve('paid'))
          // The webhook still credits the scans if this call fails.
          .catch(() => resolve('paid'));
      },
      modal: { ondismiss: () => resolve('cancelled') },
    });
    rzp.on('payment.failed', () => resolve('failed'));
    rzp.open();
  });
}
