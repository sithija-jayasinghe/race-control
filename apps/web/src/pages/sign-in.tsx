import { emailSchema } from '@race-control/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { ApiError } from '@/lib/api';
import { useRequestMagicLink } from '@/lib/auth';
import { cn } from '@/lib/utils';

const RESEND_AFTER_S = 30;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (error instanceof ApiError && error.status === 0) return "Can't reach Race Control. Check your connection and try again.";
  return 'Something went wrong. Try again.';
}

export const primaryButton =
  'h-11 w-full rounded-xl bg-foreground font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50';
export const quietButton = 'h-10 rounded-xl px-3 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground';
export const inputClass =
  'h-11 w-full rounded-xl border border-input bg-black/20 px-3.5 text-base outline-none placeholder:text-muted-foreground/60 focus:border-ring aria-invalid:border-flag-red';

export function SignInPage() {
  const request = useRequestMagicLink();
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
              <span className="font-medium text-foreground">Development mode:</span> no email is sent. The link is
              printed in the terminal running <code className="font-mono text-xs">pnpm dev</code>, after{' '}
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
          <p className="text-sm text-muted-foreground">Sign in to the pit wall with your email. No password needed.</p>
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
          {request.isError && (
            <p role="alert" className="text-sm text-flag-red">
              {errorMessage(request.error)}
            </p>
          )}
        </div>
        <button type="submit" className={primaryButton} disabled={request.isPending}>
          {request.isPending ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>
    </FullScreen>
  );
}
