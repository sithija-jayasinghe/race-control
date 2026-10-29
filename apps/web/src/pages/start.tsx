import { createTeamRequestSchema } from '@race-control/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { ApiError } from '@/lib/api';
import { useSignOut } from '@/lib/auth';
import { useCreateTeam } from '@/lib/teams';
import { inputClass, primaryButton, quietButton } from '@/pages/sign-in';
import { useSignedInContext } from '@/routes';

/** Create a team (you become its lead). First run for people with no team, and "Create a team" for everyone else. */
export function StartPage() {
  const { me } = useSignedInContext();
  const create = useCreateTeam();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [inputError, setInputError] = useState<string>();
  const hasTeams = me.teams.length > 0;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = createTeamRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setInputError('Give your team a name, up to 80 characters.');
      return;
    }
    create.mutate(parsed.data.name, { onSuccess: (team) => void navigate(`/t/${team.id}`) });
  };

  return (
    <FullScreen>
      <form noValidate onSubmit={onSubmit} className="glass space-y-5 rounded-2xl p-6">
        <div className="space-y-2">
          <h1 className="broadcast text-2xl">{hasTeams ? 'New team' : 'Build your team'}</h1>
          <p className="text-sm text-muted-foreground">
            You'll be its lead. Then invite your developers and connect their agents.
          </p>
        </div>
        <div className="space-y-2">
          <input
            name="name"
            aria-label="Team name"
            autoFocus
            maxLength={80}
            placeholder="BuildFlow"
            aria-invalid={inputError ? true : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setInputError(undefined);
            }}
            className={inputClass}
          />
          {inputError && <p className="text-sm text-flag-red">{inputError}</p>}
          {create.isError && (
            <p role="alert" className="text-sm text-flag-red">
              {create.error instanceof ApiError && create.error.status === 0
                ? "Can't reach Race Control. Check your connection and try again."
                : "Couldn't create the team. Try again."}
            </p>
          )}
        </div>
        <button type="submit" className={primaryButton} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create team'}
        </button>
        <p className="text-sm text-muted-foreground">
          Joining a team instead? Open the invite link your lead sent you.
        </p>
        <div className="-mx-3 flex justify-between">
          {hasTeams ? (
            <Link to="/" className={quietButton + ' grid place-items-center'}>
              Back to the pit wall
            </Link>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={quietButton}
            onClick={() => signOut.mutate(undefined, { onSettled: () => void navigate('/sign-in', { replace: true }) })}
          >
            Sign out
          </button>
        </div>
      </form>
    </FullScreen>
  );
}
