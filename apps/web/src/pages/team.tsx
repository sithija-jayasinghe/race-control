import type { Member, Role } from '@race-control/shared';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { CopyButton } from '@/components/copy-button';
import { Panel } from '@/components/panel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api';
import {
  useChangeRole,
  useCreateInvite,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
} from '@/lib/teams';
import { cn } from '@/lib/utils';
import { primaryButton, quietButton } from '@/pages/sign-in';
import { useTeamContext } from '@/routes';

const LAST_LEAD = 'A team needs at least one lead. Make someone else a lead first.';

function memberError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'last_lead') return LAST_LEAD;
  return "That didn't work. Try again.";
}

function daysLeft(iso: string) {
  const days = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function RoleTag({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        'broadcast rounded px-1.5 py-0.5 text-[11px]',
        role === 'lead' ? 'bg-foreground text-background' : 'border border-glass-line text-muted-foreground',
      )}
    >
      {role === 'lead' ? 'Lead' : 'Dev'}
    </span>
  );
}

function MemberRow({ member, isMe, canManage, teamId }: { member: Member; isMe: boolean; canManage: boolean; teamId: string }) {
  const changeRole = useChangeRole(teamId);
  const remove = useRemoveMember(teamId);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const label = member.name ?? member.email;
  const error = changeRole.error ?? remove.error;

  const confirmRemove = () =>
    remove.mutate(member.userId, {
      onSuccess: () => {
        if (isMe) void navigate('/', { replace: true });
      },
      onSettled: () => setConfirming(false),
    });

  return (
    <li className="border-t border-white/5 px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] font-display text-sm font-bold uppercase"
        >
          {label.charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {label}
            {isMe && <span className="text-muted-foreground"> (you)</span>}
          </span>
          {member.name && <span className="block truncate text-xs text-muted-foreground">{member.email}</span>}
        </span>
        <RoleTag role={member.role} />
        {(canManage || isMe) && !confirming && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${label}`}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-glass-line bg-glass-strong backdrop-blur-xl">
              {canManage && (
                <DropdownMenuItem
                  onSelect={() =>
                    changeRole.mutate({ userId: member.userId, role: member.role === 'lead' ? 'developer' : 'lead' })
                  }
                >
                  {member.role === 'lead' ? 'Make developer' : 'Make lead'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                {isMe ? 'Leave team' : 'Remove from team'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
          <span className="mr-auto text-muted-foreground">
            {isMe ? 'Leave this team? You’ll need a new invite to rejoin.' : `Remove ${label}? Their tokens stop working.`}
          </span>
          <button type="button" className={quietButton} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="h-10 rounded-xl bg-flag-red px-3 font-medium text-white disabled:opacity-50"
            disabled={remove.isPending}
            onClick={confirmRemove}
          >
            {isMe ? 'Leave' : 'Remove'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-flag-red">
          {memberError(error)}
        </p>
      )}
    </li>
  );
}

function InvitePanel({ teamId }: { teamId: string }) {
  const invites = useInvites(teamId, true);
  const create = useCreateInvite(teamId);
  const revoke = useRevokeInvite(teamId);
  const [role, setRole] = useState<Role>('developer');

  return (
    <Panel title="Invite links">
      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          <div role="radiogroup" aria-label="Role for new members" className="flex rounded-xl border border-glass-line p-1">
            {(['developer', 'lead'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  'h-8 rounded-lg px-3 text-sm text-muted-foreground',
                  role === r && 'bg-white/10 text-foreground',
                )}
              >
                {r === 'lead' ? 'Lead' : 'Developer'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={cn(primaryButton, 'h-10 flex-1')}
            disabled={create.isPending}
            onClick={() => create.mutate(role)}
          >
            Create link
          </button>
        </div>

        {create.data && (
          <div className="space-y-2 rounded-xl border border-flag-green/30 bg-flag-green/5 p-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="New invite link"
                value={create.data.url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-lg bg-black/30 px-2.5 font-mono text-xs outline-none"
              />
              <CopyButton text={create.data.url} label="invite link" />
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can join as a {create.data.role === 'lead' ? 'lead' : 'developer'} for 7 days. It
              won't be shown again.
            </p>
          </div>
        )}
        {create.isError && (
          <p role="alert" className="text-sm text-flag-red">
            Couldn't create a link. Try again.
          </p>
        )}

        {invites.data && invites.data.length > 0 && (
          <ul aria-label="Active invite links" className="space-y-1">
            {invites.data.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm">
                <RoleTag role={invite.role} />
                <span className="flex-1 text-muted-foreground">{daysLeft(invite.expiresAt)}</span>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-flag-red"
                  aria-label={`Revoke ${invite.role} invite with ${daysLeft(invite.expiresAt)}`}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function TeamPage() {
  const { me, team } = useTeamContext();
  const members = useMembers(team.id);
  const isLead = team.role === 'lead';

  return (
    <AppShell team={team} teams={me.teams} active="team" userEmail={me.user.email}>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-baseline gap-3">
          <h1 className="broadcast text-2xl">Team</h1>
          {members.data && (
            <span className="font-mono text-xs text-muted-foreground">
              {members.data.length} {members.data.length === 1 ? 'member' : 'members'}
            </span>
          )}
        </div>
        <div className={cn('grid gap-4', isLead && 'md:grid-cols-[minmax(0,1fr)_320px]')}>
          <Panel title="Members">
            {members.isPending && (
              <div role="status" className="space-y-3 p-4">
                <span className="sr-only">Loading members</span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            )}
            {members.isError && (
              <p role="alert" className="p-4 text-sm text-flag-red">
                Couldn't load members.{' '}
                <button type="button" className="underline" onClick={() => void members.refetch()}>
                  Try again
                </button>
              </p>
            )}
            {members.data && (
              <ul>
                {members.data.map((member) => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    isMe={member.userId === me.user.id}
                    canManage={isLead}
                    teamId={team.id}
                  />
                ))}
              </ul>
            )}
          </Panel>
          {isLead && <InvitePanel teamId={team.id} />}
        </div>
      </div>
    </AppShell>
  );
}
