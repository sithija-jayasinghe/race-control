import type { MeResponse, MyTeam } from '@race-control/shared';
import { Navigate, Outlet, useLocation, useOutletContext, useParams, type RouteObject } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { rememberNextPath, useMe } from '@/lib/auth';
import { InvitePage } from '@/pages/invite';
import { PitWallPage } from '@/pages/pit-wall';
import { SignInPage } from '@/pages/sign-in';
import { StartPage } from '@/pages/start';
import { TeamPage } from '@/pages/team';
import { VerifyPage } from '@/pages/verify';

type SignedInContext = { me: MeResponse };
type TeamContext = SignedInContext & { team: MyTeam };

export const useSignedInContext = () => useOutletContext<SignedInContext>();
export const useTeamContext = () => useOutletContext<TeamContext>();

function Loading() {
  return (
    <FullScreen>
      <div role="status" className="flex flex-col items-center gap-4">
        <StartLights lit={0} size="sm" className="motion-safe:animate-pulse" />
        <span className="sr-only">Loading</span>
      </div>
    </FullScreen>
  );
}

/** Pages behind sign-in. Signed-out visitors go to /sign-in and come back here afterwards. */
function RequireSignIn() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Loading />;
  if (me.isError) {
    return (
      <FullScreen>
        <div role="alert" className="glass space-y-3 rounded-2xl p-6">
          <h1 className="broadcast text-2xl">Can't reach Race Control</h1>
          <p className="text-sm text-muted-foreground">Check your connection, then try again.</p>
          <button type="button" className="text-sm underline" onClick={() => void me.refetch()}>
            Try again
          </button>
        </div>
      </FullScreen>
    );
  }
  if (!me.data) {
    rememberNextPath(location.pathname + location.search);
    return <Navigate to="/sign-in" replace />;
  }
  return <Outlet context={{ me: me.data } satisfies SignedInContext} />;
}

/** `/`: your first team's Pit wall, or the first-run page if you have none. */
function Home() {
  const { me } = useSignedInContext();
  const first = me.teams[0];
  return <Navigate to={first ? `/t/${first.id}` : '/start'} replace />;
}

/** Pages for one team. A team you're not in looks the same as one that doesn't exist. */
function TeamLayout() {
  const { me } = useSignedInContext();
  const { teamId } = useParams();
  const team = me.teams.find((t) => t.id === teamId);
  if (!team) return <NotFound />;
  return <Outlet context={{ me, team } satisfies TeamContext} />;
}

function NotFound() {
  return (
    <FullScreen>
      <div className="glass space-y-3 rounded-2xl p-6">
        <h1 className="broadcast text-2xl">Off track</h1>
        <p className="text-sm text-muted-foreground">This page doesn't exist, or you don't have access to it.</p>
        <a href="/" className="text-sm underline">
          Back to the pit wall
        </a>
      </div>
    </FullScreen>
  );
}

/** Signed-in visitors skip the sign-in page. */
function SignInRoute() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.data) return <Navigate to="/" replace />;
  return <SignInPage />;
}

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInRoute /> },
  { path: '/auth/verify', element: <VerifyPage /> },
  { path: '/invite', element: <InvitePage /> },
  {
    element: <RequireSignIn />,
    children: [
      { index: true, element: <Home /> },
      { path: '/start', element: <StartPage /> },
      {
        path: '/t/:teamId',
        element: <TeamLayout />,
        children: [
          { index: true, element: <PitWallPage /> },
          { path: 'team', element: <TeamPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];
