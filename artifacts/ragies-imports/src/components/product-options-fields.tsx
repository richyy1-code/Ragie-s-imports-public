import { buildRowsPayload, emptyOptionRow, optionEditorRows, type OptionRow, type OptionsState } from '@/lib/product-options';

type Props = { value: OptionsState; onChange: (next: OptionsState) => void; prefix: string };
const box = 'mt-2 h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm';

export function ProductOptionsFields({ value, onChange, prefix }: Props) {
  const rows = optionEditorRows(value);
  const parsed = buildRowsPayload(rows);
  const legacy = value.legacySharedStock !== undefined && !value.rows;
  const total = legacy ? value.legacySharedStock! : parsed.ok ? parsed.data.stockQuantity : null;
  const update = (next: OptionRow[], quantityEdited = false) => {
    const payload = buildRowsPayload(next);
    onChange({ ...value, rows: next, stockQuantity: payload.ok ? String(payload.data.stockQuantity) : '',
      quantitiesConfirmed: value.quantitiesConfirmed || quantityEdited });
  };
  const set = (index: number, key: keyof OptionRow, text: string) => update(rows.map((row, i) =>
    i === index ? { ...row, [key]: text } : row), key === 'quantity');
  return <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-4 sm:col-span-2" data-testid={`${prefix}-option-rows`}>
    <legend className="px-1 text-sm font-bold">Product options</legend>
    {rows.map((row, index) => <div key={index} className="rounded-xl bg-card p-3" data-testid={`${prefix}-option-row-${index}`}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-semibold" htmlFor={`${prefix}-size-type-${index}`}>Size or type
          <input id={`${prefix}-size-type-${index}`} value={row.sizeType} onChange={(event) => set(index, 'sizeType', event.target.value)} placeholder="Optional" className={box} data-testid={`input-${prefix}-size-type-${index}`} />
        </label>
        <label className="min-w-0 text-sm font-semibold" htmlFor={`${prefix}-colour-${index}`}>Colour
          <input id={`${prefix}-colour-${index}`} value={row.color} onChange={(event) => set(index, 'color', event.target.value)} placeholder="Optional" className={box} data-testid={`input-${prefix}-colour-${index}`} />
        </label>
        <label className="min-w-0 text-sm font-semibold" htmlFor={`${prefix}-quantity-${index}`}>Quantity
          <input id={`${prefix}-quantity-${index}`} type="number" min={0} step={1} value={row.quantity} onChange={(event) => set(index, 'quantity', event.target.value)} onBlur={() => { if (!row.quantity.trim()) set(index, 'quantity', '0'); }} className={box} data-testid={`input-${prefix}-quantity-${index}`} />
        </label>
      </div>
      {rows.length > 1 && <button type="button" onClick={() => update(rows.filter((_, i) => i !== index))} aria-label={`Remove option ${index + 1}`} className="mt-3 text-xs font-semibold text-destructive" data-testid={`button-${prefix}-remove-option-${index}`}>Remove</button>}
    </div>)}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={() => update([...rows, emptyOptionRow()])} className="rounded-full border border-primary px-4 py-2 text-sm font-bold text-primary" data-testid={`button-${prefix}-add-option`}>Add another option</button>
      <p className="text-sm font-bold" aria-live="polite">Total quantity: <output data-testid={`input-${prefix}-stock`}>{total ?? '—'}</output></p>
    </div>
    {value.legacySharedStock !== undefined && !value.quantitiesConfirmed && <p className="text-xs text-muted-foreground">Current shared stock: {value.legacySharedStock}. Enter quantities for each option to change how stock is counted.</p>}
    {!parsed.ok && <p role="alert" className="text-xs text-destructive">{parsed.errors[0]}</p>}
  </fieldset>;
}
