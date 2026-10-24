import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { getListAdminInventoryQueryKey, getListProductsQueryKey, useDeleteProduct, type Product } from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function ProductDeleteButton({ product, onDeleted }: { product: Pick<Product, 'id' | 'name'>; onDeleted: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteProduct();
  const client = useQueryClient();
  const confirm = () => remove.mutate({ id: product.id }, {
    onSuccess: () => {
      const withoutProduct = (rows: Product[] | undefined) => rows?.filter((row) => row.id !== product.id);
      client.setQueriesData<Product[]>({ queryKey: getListAdminInventoryQueryKey() }, withoutProduct);
      client.setQueriesData<Product[]>({ queryKey: getListProductsQueryKey() }, withoutProduct);
      window.dispatchEvent(new CustomEvent('ragies-product-deleted', { detail: product.id }));
      void client.invalidateQueries();
      setOpen(false);
      onDeleted(product.name);
    },
  });
  return <>
    <button type="button" onClick={() => { remove.reset(); setOpen(true); }} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-destructive/30 px-4 py-2 text-xs font-bold text-destructive" data-testid={`button-delete-product-${product.id}`}>
      <Trash2 size={15} /> Delete product
    </button>
    <AlertDialog open={open} onOpenChange={(next) => { if (!remove.isPending) setOpen(next); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {product.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the product from the admin catalog and storefront. It cannot be restored. Existing order history is preserved. To remove it only from the storefront, use Hide in Inventory instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending} data-testid="button-cancel-product-deletion">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isPending} onClick={(event) => { event.preventDefault(); confirm(); }} className="min-h-11 bg-destructive text-white hover:bg-destructive/90" data-testid="button-confirm-product-deletion">
            {remove.isPending ? 'Deleting…' : 'Permanently delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}