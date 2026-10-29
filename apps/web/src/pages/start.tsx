import { useNavigate } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { useSignOut } from '@/lib/auth';
import { quietButton } from '@/pages/sign-in';
import { useSignedInContext } from '@/routes';

/** First run for someone with no team yet. Creating a team arrives in step 7c. */
export function StartPage() {
  const { me } = useSignedInContext();
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <FullScreen>
      <div className="glass space-y-4 rounded-2xl p-6">
        <div className="space-y-2">
          <h1 className="broadcast text-2xl">You're in</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{me.user.email}</span>. You're not on a team yet:
            ask your lead for an invite link.
          </p>
        </div>
        <button
          type="button"
          className={`${quietButton} -ml-3`}
          onClick={() => signOut.mutate(undefined, { onSettled: () => void navigate('/sign-in', { replace: true }) })}
        >
          Sign out
        </button>
      </div>
    </FullScreen>
  );
}
