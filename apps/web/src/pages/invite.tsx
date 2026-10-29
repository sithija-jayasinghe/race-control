import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { ApiError } from '@/lib/api';
import { rememberNextPath, useMe } from '@/lib/auth';
import { forgetInvite, readPendingInvite, rememberInvite, useAcceptInvite, useInvitePreview } from '@/lib/teams';
import { primaryButton } from '@/pages/sign-in';

/**
 * The invite token arrives in `#token=…`. It's moved out of the address bar into storage straight away,
 * so it survives signing in (often in another tab) and is never left in the history.
 */
function takeInviteToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    rememberInvite(fromHash);
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    return fromHash;
  }
  return readPendingInvite();
}

function daysLeft(expiresAt: string): number {
  return Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <FullScreen>
      <div role="alert" className="glass space-y-4 rounded-2xl p-6">
        <div className="space-y-2">
          <h1 className="broadcast text-2xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <Link to="/" className={`${primaryButton} grid place-items-center`}>
          Go to Race Control
        </Link>
      </div>
    </FullScreen>
  );
}

export function InvitePage() {
  const [token] = useState(takeInviteToken);
  const me = useMe();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();
  const navigate = useNavigate();

  useEffect(() => {
    if (preview.isError) forgetInvite();
  }, [preview.isError]);

  if (!token) {
    return <Message title="No invite here" body="Open the full invite link your lead sent you." />;
  }
  if (preview.isError) {
    return (
      <Message
        title="Invite expired"
        body="This link has expired or was revoked. Ask your lead for a new one; invite links last 7 days."
      />
    );
  }
  if (preview.isPending || me.isPending) {
    return (
      <FullScreen>
        <div role="status" className="flex justify-center">
          <StartLights lit={0} size="sm" className="motion-safe:animate-pulse" />
          <span className="sr-only">Loading</span>
        </div>
      </FullScreen>
    );
  }

  const invite = preview.data;
  const join = () =>
    accept.mutate(token, {
      onSuccess: (team) => {
        forgetInvite();
        void navigate(`/t/${team.id}`, { replace: true });
      },
    });
  const signInToJoin = () => {
    rememberNextPath('/invite');
    void navigate('/sign-in');
  };

  return (
    <FullScreen>
      <div className="glass overflow-hidden rounded-2xl">
        <div className="kerb" aria-hidden="true" />
        <div className="space-y-5 p-6">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">You're invited to join</p>
            <h1 className="broadcast text-3xl break-words">{invite.teamName}</h1>
            <p className="text-sm text-muted-foreground">
              as a {invite.role === 'lead' ? 'lead' : 'developer'} · link valid for {daysLeft(invite.expiresAt)} more{' '}
              {daysLeft(invite.expiresAt) === 1 ? 'day' : 'days'}
            </p>
          </div>
          {accept.isError && (
            <p role="alert" className="text-sm text-flag-red">
              {accept.error instanceof ApiError && accept.error.status === 400
                ? 'This invite stopped working. Ask your lead for a new link.'
                : "Couldn't join the team. Try again."}
            </p>
          )}
          {me.data ? (
            <button type="button" className={primaryButton} onClick={join} disabled={accept.isPending}>
              {accept.isPending ? 'Joining…' : `Join ${invite.teamName}`}
            </button>
          ) : (
            <>
              <button type="button" className={primaryButton} onClick={signInToJoin}>
                Sign in to join
              </button>
              <p className="text-xs text-muted-foreground">
                Open the sign-in email on this device and you'll come straight back here.
              </p>
            </>
          )}
        </div>
      </div>
    </FullScreen>
  );
}
