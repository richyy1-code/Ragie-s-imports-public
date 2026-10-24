import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { getListStaffQueryKey, useRemoveStaff, type StaffMember } from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function StaffList({ members, isOwner, onEdit, onToggle, togglePending, onRemoved }: {
  members: StaffMember[];
  isOwner: boolean;
  onEdit: (member: StaffMember) => void;
  onToggle: (member: StaffMember) => void;
  togglePending: boolean;
  onRemoved: (member: StaffMember) => void;
}) {
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [message, setMessage] = useState('');
  const remove = useRemoveStaff();
  const client = useQueryClient();
  const confirm = () => {
    if (!selected) return;
    const member = selected;
    remove.mutate({ id: member.id }, {
      onSuccess: () => {
        client.setQueryData<StaffMember[]>(getListStaffQueryKey(), (rows) => rows?.filter((row) => row.id !== member.id));
        void client.invalidateQueries({ queryKey: getListStaffQueryKey() });
        onRemoved(member);
        setMessage(`${member.name} has been removed from staff. Their customer account and orders were preserved.`);
        setSelected(null);
      },
    });
  };
  const actions = (member: StaffMember) => member.role === 'owner'
    ? <span className="text-xs font-semibold text-muted-foreground">Protected owner</span>
    : <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => onEdit(member)} disabled={remove.isPending || togglePending} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 py-2 text-xs font-bold" aria-label={`Edit ${member.name}`} data-testid={`button-edit-staff-${member.id}`}><Pencil size={14} /> Edit</button>
      <button type="button" onClick={() => onToggle(member)} disabled={remove.isPending || togglePending} className="min-h-11 rounded-full border border-border px-3 py-2 text-xs font-bold" data-testid={`button-toggle-staff-${member.id}`}>{member.active ? 'Deactivate' : 'Reactivate'}</button>
      {isOwner && <button type="button" onClick={() => { remove.reset(); setMessage(''); setSelected(member); }} disabled={remove.isPending || togglePending} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-destructive/30 px-3 py-2 text-xs font-bold text-destructive" data-testid={`button-remove-staff-${member.id}`}><Trash2 size={14} /> Remove staff</button>}
    </div>;
  const status = (member: StaffMember) => <span className={`rounded-full px-2 py-1 text-xs font-bold ${member.active ? 'bg-accent' : 'bg-muted text-muted-foreground'}`}>{member.active ? 'Active' : 'Inactive'}</span>;
  return <>
    {message && <p role="status" className="mt-5 text-sm font-semibold text-primary" data-testid="status-staff-removal">{message}</p>}
    <div className="mt-6 space-y-3 md:hidden">
      {members.map((member) => <article key={member.id} className="rounded-2xl bg-card p-5" data-testid={`card-staff-${member.id}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold">{member.name}</p><p className="break-all text-xs text-muted-foreground">{member.email}</p></div>{status(member)}</div>
        <p className="mt-3 text-sm capitalize">{member.role}</p>
        <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{member.permissions.join(' · ')}</p>
        <div className="mt-4">{actions(member)}</div>
      </article>)}
    </div>
    <div className="mt-6 hidden overflow-x-auto rounded-2xl bg-card md:block">
      <table className="w-full text-left text-sm"><thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="p-4">Staff</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Permissions</th><th className="p-4">Actions</th></tr></thead>
        <tbody>{members.map((member) => <tr key={member.id} className="border-b border-border last:border-0" data-testid={`row-staff-${member.id}`}>
          <td className="p-4"><p className="font-bold">{member.name}</p><p className="text-xs text-muted-foreground">{member.email}</p></td>
          <td className="p-3 capitalize">{member.role}</td><td className="p-3">{status(member)}</td>
          <td className="max-w-sm p-3 text-xs text-muted-foreground">{member.permissions.join(' · ')}</td><td className="p-4">{actions(member)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!members.length && <p className="mt-4 text-sm text-muted-foreground">No staff members found.</p>}
    <AlertDialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !remove.isPending) setSelected(null); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {selected?.name} from staff?</AlertDialogTitle>
          <AlertDialogDescription>This removes their staff role and all admin permissions. They will no longer be able to use the admin dashboard, including from an existing session. Their customer account and order history will not be deleted. An owner can add them as staff again later.</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending} data-testid="button-cancel-staff-removal">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isPending} onClick={(event) => { event.preventDefault(); confirm(); }} className="min-h-11 bg-destructive text-white hover:bg-destructive/90" data-testid="button-confirm-staff-removal">{remove.isPending ? 'Removing…' : 'Remove staff'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}