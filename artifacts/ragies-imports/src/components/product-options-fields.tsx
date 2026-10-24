import { buildOptionsPayload, parseSizeMatrix, type OptionsState } from '@/lib/product-options';

type Props = { value: OptionsState; onChange: (next: OptionsState) => void; prefix: string };

const box = 'mt-2 w-full rounded-xl border border-input bg-background p-4 text-sm disabled:cursor-not-allowed disabled:opacity-50';

export function ProductOptionsFields({ value, onChange, prefix }: Props) {
  const set = (key: keyof OptionsState, next: string) => onChange({ ...value, [key]: next });
  const matrixUsed = value.matrix.trim().length > 0;
  const parsed = matrixUsed ? parseSizeMatrix(value.matrix) : null;
  const stockError = !matrixUsed ? (() => { const result = buildOptionsPayload(value); return result.ok ? '' : result.errors[0]; })() : '';
  const total = parsed && parsed.errors.length === 0 ? String(parsed.total) : matrixUsed ? '' : value.stockQuantity;
  return <>
    <label className="sm:col-span-2" htmlFor={`${prefix}-matrix`}>
      <span className="text-sm font-bold">Sizes, colours and quantities (optional)</span>
      <span className="mt-1 block text-xs text-muted-foreground">One size per line, each colour with its quantity, for example: M: Red=5, Blue=3. When used, this replaces the colours, sizes and types below and sets total stock for you.</span>
      <textarea id={`${prefix}-matrix`} value={value.matrix} onChange={(event) => set('matrix', event.target.value)} rows={4} placeholder={'M: Red=5, Blue=3\nL: Black=4'} aria-invalid={Boolean(parsed?.errors.length)} aria-describedby={`${prefix}-matrix-errors`} className={`${box} resize-y font-mono`} data-testid={`input-${prefix}-matrix`} />
      <span id={`${prefix}-matrix-errors`} role={parsed?.errors.length ? 'alert' : undefined} className="block">
        {parsed?.errors.map((message) => <span key={message} className="mt-1 block text-xs text-destructive" data-testid={`error-${prefix}-matrix`}>{message}</span>)}
        {parsed && !parsed.errors.length && <span className="mt-1 block text-xs font-semibold text-primary">{parsed.variants.length} size(s), {parsed.variants.reduce((sum, variant) => sum + variant.colors.length, 0)} combination(s), {parsed.total} in total.</span>}
      </span>
    </label>
    <label><span className="text-sm font-bold">Main colours (optional, comma-separated)</span><input value={matrixUsed ? '' : value.colors} disabled={matrixUsed} onChange={(event) => set('colors', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm disabled:opacity-50" data-testid={`input-${prefix}-colors`} /></label>
    <label><span className="text-sm font-bold">Sizes (optional, comma-separated)</span><input value={matrixUsed ? '' : value.sizes} disabled={matrixUsed} onChange={(event) => set('sizes', event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-4 text-sm disabled:opacity-50" data-testid={`input-${prefix}-sizes`} /></label>
    <label className="sm:col-span-2"><span className="text-sm font-bold">Types and their colours (optional)</span><span className="mt-1 block text-xs text-muted-foreground">Add one type per line, for example: King size: Cream, Grey</span><textarea value={matrixUsed ? '' : value.variants} disabled={matrixUsed} onChange={(event) => set('variants', event.target.value)} rows={3} placeholder={'King size: Cream, Grey\nQueen size: Blue'} className={`${box} resize-y`} data-testid={`input-${prefix}-variants`} /></label>
    <label className="sm:col-span-2"><span className="text-sm font-bold">Stock quantity{matrixUsed ? ' (total of all combinations)' : ''}</span><input type="number" min={0} step={1} value={total} readOnly={matrixUsed} required={!matrixUsed} onChange={(event) => set('stockQuantity', event.target.value)} className={`mt-2 h-12 w-full rounded-xl border border-input px-4 text-sm ${matrixUsed ? 'bg-muted' : 'bg-background'}`} data-testid={`input-${prefix}-stock`} />{stockError && <span role="alert" className="mt-1 block text-xs text-destructive">{stockError}</span>}</label>
  </>;
}
