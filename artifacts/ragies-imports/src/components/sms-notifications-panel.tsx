import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { getGetAdminSmsQueryKey, useGetAdminSms, useSendAdminTestSms } from "@workspace/api-client-react";
import { PhoneInput } from '@/components/phone-input';
import { normalizeContactPhone } from '@/lib/phone-numbers';

const errorMessage = (error: unknown) => {
  const value = error as { data?: { error?: string }; message?: string };
  return value?.data?.error ?? value?.message ?? "Could not complete the SMS request.";
};
const labels: Record<string, string> = {
  pending: "Queued", sending: "Sending", accepted: "Accepted by provider",
  failed: "Failed", unknown: "Unconfirmed — check provider logs", skipped: "Skipped",
};

export function SmsNotificationsPanel() {
  const query = useGetAdminSms({ query: { queryKey: getGetAdminSmsQueryKey(), refetchInterval: 5000 } });
  const send = useSendAdminTestSms();
  const client = useQueryClient();
  const [phone, setPhone] = useState("");
  const [confirmLiveSend, setConfirmLiveSend] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(false);
    send.mutate({ data: { phone: normalizeContactPhone(phone) ?? phone.trim(), confirmLiveSend } }, { onSuccess: () => {
      setSubmitted(true);
      void client.invalidateQueries({ queryKey: getGetAdminSmsQueryKey() });
    } });
  };
  return <div className="space-y-6" data-testid="panel-sms-notifications">
    <div>
      <p className="eyebrow text-primary">Customer notifications</p>
      <h1 className="serif mt-2 text-4xl font-semibold">SMS messaging.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Payment confirmations and order updates.</p>
    </div>
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold"><MessageCircle size={18} /> SMS service</h2>
        <span className="rounded-full bg-card px-3 py-1 text-xs font-bold" data-testid="status-sms-configured">{query.isLoading ? "Checking configuration…" : query.isError ? "Configuration unavailable" : query.data?.configured ? "Live sending configured" : "Sending paused"}</span>
      </div>
      <p className="mt-3 text-sm leading-6">App username: <strong data-testid="sms-app-username">{query.data?.username ?? "Not configured"}</strong> · Sender ID: <strong>{query.data?.senderId ?? "Not approved / not configured"}</strong>.</p>
      {!query.isLoading && !query.isError && !query.data?.configured && <div className="mt-3 rounded-xl border border-primary/20 bg-card p-4 text-sm leading-6" role="status" data-testid="sms-sending-paused">
        Sending is paused. Missing: {query.data?.missingSettings.join(", ")}. New payment confirmations and order updates stay queued. Once the approved sender ID is configured, queued messages will be sent automatically.
      </div>}
      <p className="mt-3 text-sm leading-6">Live messages reach real phones and use your Africa’s Talking balance. Only new confirmed payments and new status changes are queued—not historical orders. “Accepted” means the provider accepted the request, not proof of delivery.</p>
      <a href="https://help.africastalking.com/en/articles/11582333-ghana-bulk-sms" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-primary underline">Ghana sender ID registration requirements</a>
    </section>
    {query.isError && <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">{errorMessage(query.error)} <button onClick={() => void query.refetch()} className="ml-2 underline">Retry</button></div>}
    {query.data?.canSendTest && <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-bold">Send a live test</h2>
       <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
         <div className="min-w-0 flex-1"><PhoneInput label="Recipient phone number" value={phone} onChange={(value) => { setPhone(value); setSubmitted(false); send.reset(); }} required testId="input-sms-test-phone" /></div>
        <button disabled={send.isPending || !query.data.configured || !phone.trim() || !confirmLiveSend} className="flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-send-test-sms"><Send size={16} />{send.isPending ? "Queuing…" : "Send live test SMS"}</button>
      </div>
      <label className="mt-4 flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" checked={confirmLiveSend} onChange={(event) => setConfirmLiveSend(event.target.checked)} disabled={!query.data.configured} className="mt-1" data-testid="checkbox-confirm-live-sms" />
        I understand this sends a real SMS and uses my Africa’s Talking balance.
      </label>
      {submitted && <p className="mt-3 text-sm text-primary" role="status">Test queued. The log below will show whether Africa’s Talking accepted it.</p>}
      {send.isError && <p className="mt-3 text-sm text-destructive" role="alert">{errorMessage(send.error)}</p>}
    </form>}
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border p-5">
        <h2 className="font-bold">Recent SMS attempts</h2>
        <button onClick={() => void query.refetch()} className="flex items-center gap-2 text-xs font-semibold" disabled={query.isFetching}><RefreshCw size={14} /> Refresh</button>
      </div>
      {query.isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading messages…</p>
        : !query.data?.notifications.length ? <p className="p-5 text-sm text-muted-foreground">No messages yet.</p>
        : <div className="divide-y divide-border" data-testid="list-sms-notifications">{query.data.notifications.map((item) => <article key={item.id} className="p-5" data-testid={`sms-notification-${item.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="font-bold">{item.phone} <span className="ml-2 font-normal text-muted-foreground">{({ payment: "Payment confirmation", "order-status": "Order update", arrival: "Confirmed arrival", "staff-eta": "Staff ETA reminder", "eta-due": "Previous customer ETA reminder", "eta-update": "Previous arrival estimate update", test: "Live test" } as Record<string, string>)[item.kind] ?? "Order update"}</span></p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${["failed", "unknown", "skipped"].includes(item.status) ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>{item.status === "pending" && !query.data.configured ? "Queued" : labels[item.status] ?? item.status}</span>
          </div>
          <p className="mt-3 break-words text-sm leading-6">{item.message}</p>
          {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
          <p className="mt-3 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()} · {item.attempts} sending attempt{item.attempts === 1 ? "" : "s"}{item.providerMessageId ? ` · ${item.providerMessageId}` : ""}</p>
        </article>)}</div>}
    </section>
  </div>;
}
