import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { takeNextPath, useVerifyMagicLink } from '@/lib/auth';
import { primaryButton } from '@/pages/sign-in';

/** Reads `#token=…` once and removes it from the address bar and history, so it can't be copied or reused. */
function takeTokenFromHash(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return token;
}

/** The magic link lands here. Signs in, then continues to where you were going. */
export function VerifyPage() {
  const verify = useVerifyMagicLink();
  const navigate = useNavigate();
  const [lit, setLit] = useState(0);
  const [missing, setMissing] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // The link works only once, so make sure it's sent once even when effects run twice in development.
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromHash();
    if (!token) {
      setMissing(true);
      return;
    }
    verify.mutate(token, { onSuccess: () => void navigate(takeNextPath(), { replace: true }) });
  }, [verify, navigate]);

  useEffect(() => {
    if (!verify.isPending || lit >= 5) return;
    const id = setTimeout(() => setLit((n) => n + 1), 180);
    return () => clearTimeout(id);
  }, [verify.isPending, lit]);

  if (missing || verify.isError) {
    return (
      <FullScreen>
        <div role="alert" className="glass space-y-5 rounded-2xl p-6">
          <StartLights lit={0} size="sm" />
          <div className="space-y-2">
            <h1 className="broadcast text-2xl">Link didn't work</h1>
            <p className="text-sm text-muted-foreground">
              It may have expired or already been used. Sign-in links work once, for 15 minutes.
            </p>
          </div>
          <Link to="/sign-in" className={`${primaryButton} grid place-items-center`}>
            Send a new link
          </Link>
        </div>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-6" role="status">
        <StartLights lit={lit} />
        <p className="broadcast text-lg">Signing you in</p>
      </div>
    </FullScreen>
  );
}
