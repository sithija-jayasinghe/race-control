import { emailSchema, SIGN_IN_ERRORS, type SignInError, type SignInProvider } from '@race-control/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { ApiError } from '@/lib/api';
import { peekNextPath, takeNextPath, useAuthProviders, useRequestMagicLink } from '@/lib/auth';
import { cn } from '@/lib/utils';

const RESEND_AFTER_S = 30;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (error instanceof ApiError && error.status === 502) return 'Couldn’t send the email. Try again in a minute.';
  if (error instanceof ApiError && error.status === 0) return "Can't reach Race Control. Check your connection and try again.";
  return 'Something went wrong. Try again.';
}

const PROVIDER_NAMES: Record<SignInProvider, string> = { github: 'GitHub', google: 'Google' };

/** Why GitHub or Google sign-in sent the person back here. */
function providerError(params: URLSearchParams): string | undefined {
  const error = params.get('error');
  if (!error || !(SIGN_IN_ERRORS as readonly string[]).includes(error)) return undefined;
  const name = PROVIDER_NAMES[params.get('provider') as SignInProvider] ?? 'That provider';
  const messages: Record<SignInError, string> = {
    cancelled: `Signing in with ${name} was cancelled.`,
    expired: 'That sign-in took too long or was interrupted. Try again.',
    no_verified_email: `${name} didn’t share a verified email. Verify one there, or use the email link.`,
    failed: `${name} didn’t answer properly. Try again, or use the email link.`,
  };
  return messages[error as SignInError];
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3 2.33C4.69 5.16 6.67 3.58 9 3.58" />
    </svg>
  );
}

/** "or", then GitHub and Google, when this server has them. Full page links: the provider takes over from here. */
function ProviderButtons() {
  const providers = useAuthProviders();
  if (!providers.data?.length) return null;
  const href = (provider: SignInProvider) => `/api/auth/${provider}/start?${new URLSearchParams({ next: peekNextPath() }).toString()}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className={cn('grid gap-2', providers.data.length > 1 && 'grid-cols-2')}>
        {providers.data.map((provider) => (
          <a
            key={provider}
            href={href(provider)}
            // The server now carries where to go after, so it isn't used again later.
            onClick={() => takeNextPath()}
            aria-label={`Sign in with ${PROVIDER_NAMES[provider]}`}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-glass-line text-sm transition-colors hover:bg-white/5"
          >
            {provider === 'github' ? <GitHubMark /> : <GoogleMark />}
            {PROVIDER_NAMES[provider]}
          </a>
        ))}
      </div>
    </div>
  );
}

export const primaryButton =
  'h-11 w-full rounded-xl bg-foreground font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50';
export const quietButton = 'h-10 rounded-xl px-3 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground';
export const inputClass =
  'h-11 w-full rounded-xl border border-input bg-black/20 px-3.5 text-base outline-none placeholder:text-muted-foreground/60 focus:border-ring aria-invalid:border-flag-red';

export function SignInPage() {
  const request = useRequestMagicLink();
  const [params] = useSearchParams();
  const providerProblem = providerError(params);
  const [email, setEmail] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const send = (address: string) => {
    request.mutate(address, {
      onSuccess: () => {
        setSentTo(address);
        setResendIn(RESEND_AFTER_S);
      },
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setInputError('Enter a valid email address.');
      return;
    }
    send(parsed.data);
  };

  if (sentTo) {
    return (
      <FullScreen>
        <div className="glass space-y-5 rounded-2xl p-6">
          <StartLights lit={0} size="sm" />
          <div className="space-y-2">
            <h1 className="broadcast text-2xl">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <span className="font-medium text-foreground">{sentTo}</span>. It works once and
              expires in 15 minutes.
            </p>
          </div>
          {import.meta.env.DEV && (
            <p className="rounded-xl border border-flag-yellow/30 bg-flag-yellow/5 p-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Development mode:</span> unless an email service is set up,
              the link is printed in the terminal running <code className="font-mono text-xs">pnpm dev</code>, after{' '}
              <code className="font-mono text-xs">[dev mailer]</code>.
            </p>
          )}
          {request.isError && (
            <p role="alert" className="text-sm text-flag-red">
              {errorMessage(request.error)}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={quietButton} onClick={() => setSentTo(undefined)}>
              Use a different email
            </button>
            <button
              type="button"
              className={cn(quietButton, 'text-foreground')}
              disabled={resendIn > 0 || request.isPending}
              onClick={() => send(sentTo)}
            >
              {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send again'}
            </button>
          </div>
        </div>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <form noValidate onSubmit={onSubmit} className="glass space-y-5 rounded-2xl p-6">
        <StartLights lit={request.isPending ? 5 : 0} size="sm" />
        <div className="space-y-2">
          <h1 className="broadcast text-2xl">Take your seat</h1>
          <p className="text-sm text-muted-foreground">Sign in to the pit wall. No password needed.</p>
        </div>
        <div className="space-y-2">
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            aria-label="Email"
            aria-invalid={inputError ? true : undefined}
            aria-describedby={inputError ? 'email-error' : undefined}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setInputError(undefined);
            }}
            className={inputClass}
          />
          {inputError && (
            <p id="email-error" className="text-sm text-flag-red">
              {inputError}
            </p>
          )}
          {request.isError ? (
            <p role="alert" className="text-sm text-flag-red">
              {errorMessage(request.error)}
            </p>
          ) : (
            providerProblem && (
              <p role="alert" className="text-sm text-flag-red">
                {providerProblem}
              </p>
            )
          )}
        </div>
        <button type="submit" className={primaryButton} disabled={request.isPending}>
          {request.isPending ? 'Sending…' : 'Send sign-in link'}
        </button>
        <ProviderButtons />
      </form>
    </FullScreen>
  );
}
