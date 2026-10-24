import { Check, XCircle } from 'lucide-react';
import type { Order } from '@workspace/api-client-react';
import { orderProgress } from '@/lib/order-progress';

export function OrderProgress({ order }: { order: Order }) {
  const { stages, activeIndex, cancelled } = orderProgress(order);
  return <section className="mt-9" aria-label="Current order progress" aria-live="polite">
    <p className="text-xs text-secondary-foreground/60">Current order status</p>
    <p className="mt-2 text-xl font-bold" data-testid="text-tracking-order-status">{order.status}</p>
    {cancelled ? <div className="mt-5 flex items-center gap-3 text-sm"><XCircle size={22} /><p>This order has been cancelled. No further delivery steps are scheduled.</p></div>
      : <ol className="mt-5 space-y-5">{stages.map((stage, index) => <li key={stage} aria-current={index === activeIndex ? 'step' : undefined} className="flex items-center gap-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${index <= activeIndex ? 'bg-primary text-primary-foreground' : 'border border-secondary-foreground/25 text-secondary-foreground/35'}`}>{index <= activeIndex ? <Check size={15} /> : index + 1}</div>
        <div><p className={`text-sm font-bold ${index <= activeIndex ? '' : 'text-secondary-foreground/40'}`}>{stage}</p>{index === activeIndex && <p className="text-xs text-secondary-foreground/60">Current stage</p>}</div>
      </li>)}</ol>}
  </section>;
}