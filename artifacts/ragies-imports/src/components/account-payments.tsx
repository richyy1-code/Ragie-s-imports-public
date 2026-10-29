import { useState, type FormEvent } from 'react';
import { usePrepareAccountPayment, usePrepareOrderPayment, type DeliveryDetails, type Order } from '@workspace/api-client-react';
import { accountPaymentTotals, payableAccountOrders } from '@/lib/account-payment-totals';

const money = (value: number) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
const inputClass = 'mt-1 block w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground';
const buttonClass = 'rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60';
const deliveryFor = (order: Order): DeliveryDetails => ({ fulfillmentMethod: order.fulfillmentMethod === 'pickup' ? 'pickup' : 'delivery', address: order.address, city: order.city });
const errorText = (error: unknown) => {
  const candidate = error as { data?: { error?: string }; message?: string } | null;
  return candidate?.data?.error || candidate?.message || 'Could not prepare this payment.';
};

function DeliveryFields({ id, value, onChange }: { id: string; value: DeliveryDetails; onChange: (value: DeliveryDetails) => void }) {
  return <fieldset className="space-y-3" data-testid={`delivery-details-${id}`}>
    <legend className="mb-2 text-sm font-bold">Delivery details</legend>
    <label className="block text-sm">Receive your order
      <select value={value.fulfillmentMethod} onChange={(event) => onChange({ ...value, fulfillmentMethod: event.target.value as DeliveryDetails['fulfillmentMethod'] })} className={inputClass}>
        <option value="delivery">Delivery</option><option value="pickup">Pickup</option>
      </select>
    </label>
    {value.fulfillmentMethod === 'delivery' && <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Delivery address
        <textarea value={value.address} onChange={(event) => onChange({ ...value, address: event.target.value })} required maxLength={500} autoComplete="street-address" rows={2} className={inputClass} data-testid={`input-delivery-address-${id}`} />
      </label>
      <label className="block text-sm">City or town
        <input value={value.city} onChange={(event) => onChange({ ...value, city: event.target.value })} required maxLength={120} autoComplete="address-level2" className={inputClass} data-testid={`input-delivery-city-${id}`} />
      </label>
    </div>}
  </fieldset>;
}

export function AccountPaymentActions({ order }: { order: Order }) {
  const prepare = usePrepareOrderPayment();
  const [shippingOpen, setShippingOpen] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDetails>(() => deliveryFor(order));
  const begin = (purpose: 'merchandise-balance' | 'shipping-fee') => {
    prepare.mutate({ id: order.id, data: { purpose,
      expectedAmount: purpose === 'shipping-fee' ? order.shippingBalance ?? 0 : order.baseBalance ?? order.balance,
      ...(purpose === 'shipping-fee' ? { deliveryDetails: { ...delivery, address: delivery.address.trim(), city: delivery.city.trim() } } : {}),
    } }, { onSuccess: (payment) => {
      if (payment.providerReady && payment.authorizationUrl) window.location.assign(payment.authorizationUrl);
    } });
  };
  if (!order.canPayBalance && !order.canPayShippingFee) return null;
  return <div className="mt-4 border-t border-current/15 pt-4">
    <div className="flex flex-wrap gap-2">
      {order.canPayBalance && <button type="button" onClick={() => begin('merchandise-balance')} disabled={prepare.isPending} className={buttonClass} data-testid={`button-pay-balance-${order.id}`}>Pay arrears · {money(order.baseBalance ?? order.balance)}</button>}
      {order.canPayShippingFee && <button type="button" aria-expanded={shippingOpen} onClick={() => { prepare.reset(); setShippingOpen(!shippingOpen); }} disabled={prepare.isPending} className="rounded-full bg-secondary px-4 py-2 font-bold text-secondary-foreground disabled:opacity-60" data-testid={`button-pay-shipping-${order.id}`}>Pay shipping fee · {money(order.shippingBalance ?? 0)}</button>}
    </div>
    {shippingOpen && <form className="mt-4 space-y-4 rounded-xl border border-border bg-background p-4" onSubmit={(event) => { event.preventDefault(); begin('shipping-fee'); }}>
      <DeliveryFields id={String(order.id)} value={delivery} onChange={setDelivery} />
      <p className="text-xs text-muted-foreground">These details replace your checkout address after payment.</p>
      <button disabled={prepare.isPending} className={buttonClass}>{prepare.isPending ? 'Preparing payment…' : `Continue to Paystack · ${money(order.shippingBalance ?? 0)}`}</button>
    </form>}
    {prepare.isError && <p role="alert" className="mt-3 text-sm text-destructive">{errorText(prepare.error)}</p>}
  </div>;
}

export function AccountOutstandingPayment({ orders }: { orders: Order[] }) {
  const payable = payableAccountOrders(orders);
  const totals = accountPaymentTotals(payable);
  const prepare = usePrepareAccountPayment();
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<Record<number, DeliveryDetails>>({});
  if (!payable.length || totals.total <= 0) return null;
  const shippingOrders = payable.filter((order) => order.canPayShippingFee && (order.shippingBalance ?? 0) > 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    prepare.mutate({ data: { expectedAmount: totals.total, orders: payable.map((order) => {
      const delivery = deliveries[order.id] ?? deliveryFor(order);
      return { orderId: order.id, ...(order.canPayShippingFee ? { deliveryDetails: {
        ...delivery, address: delivery.address.trim(), city: delivery.city.trim(),
      } } : {}) };
    }) } }, { onSuccess: (payment) => {
      if (payment.providerReady && payment.authorizationUrl) window.location.assign(payment.authorizationUrl);
    } });
  };
  return <section className="mb-5 rounded-2xl border border-primary/20 bg-card p-5" data-testid="account-pay-all">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-lg font-bold">Outstanding payments</h2><p className="mt-1 text-sm text-muted-foreground">Arrears {money(totals.goods)} · Shipping {money(totals.shipping)}</p></div>
      <button type="button" aria-expanded={open} onClick={() => { prepare.reset(); setOpen(!open); }} disabled={prepare.isPending} className={buttonClass} data-testid="button-pay-all">Pay all outstanding · {money(totals.total)}</button>
    </div>
    {open && <form className="mt-5 space-y-5" onSubmit={submit}>
      <ul className="space-y-1 text-sm">{payable.map((order) => <li key={order.id}>{order.orderNumber} · {money(accountPaymentTotals([order]).total)}</li>)}</ul>
      {shippingOrders.map((order) => <div key={order.id} className="rounded-xl border border-border p-4"><p className="mb-3 text-sm font-bold">{order.orderNumber}</p><DeliveryFields id={`all-${order.id}`} value={deliveries[order.id] ?? deliveryFor(order)} onChange={(value) => setDeliveries((current) => ({ ...current, [order.id]: value }))} /></div>)}
      {shippingOrders.length > 0 && <p className="text-xs text-muted-foreground">Delivery details replace each order’s checkout address after payment.</p>}
      <button disabled={prepare.isPending} className={buttonClass} data-testid="button-confirm-pay-all">{prepare.isPending ? 'Preparing payment…' : `Continue to Paystack · ${money(totals.total)}`}</button>
    </form>}
    {prepare.isError && <p role="alert" className="mt-3 text-sm text-destructive">{errorText(prepare.error)}</p>}
  </section>;
}
