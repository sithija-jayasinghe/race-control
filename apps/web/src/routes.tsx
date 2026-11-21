import type { MeResponse, MyTeam } from '@race-control/shared';
import type { ComponentType } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext, useParams, type RouteObject } from 'react-router';
import { FullScreen } from '@/components/full-screen';
import { StartLights } from '@/components/start-lights';
import { rememberNextPath, useMe } from '@/lib/auth';
import { useLiveTeam, type LiveStatus } from '@/lib/live';
import { SignInPage } from '@/pages/sign-in';

/**
 * Each page is its own download, fetched the first time it's opened, so a lead tapping an approval
 * link on a phone doesn't wait for the rules editor or the track scene. On navigation the router
 * keeps the current page up until the next one has loaded. Sign-in is the first screen most people
 * see, so it stays in the main bundle.
 */
function page<Name extends string>(load: () => Promise<Record<Name, ComponentType>>, name: Name) {
  return {
    lazy: async () => ({ Component: (await load())[name] }),
    // Opening a link straight to a page (an approval from a phone) shows the start lights while it loads.
    hydrateFallbackElement: <Loading />,
  };
}

type SignedInContext = { me: MeResponse };
type TeamContext = SignedInContext & { team: MyTeam; live: LiveStatus };

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
  return <TeamLive me={me} team={team} />;
}

/** One live connection for all of a team's pages. */
function TeamLive({ me, team }: { me: MeResponse; team: MyTeam }) {
  const live = useLiveTeam(team.id);
  return <Outlet context={{ me, team, live } satisfies TeamContext} />;
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
  { path: '/auth/verify', ...page(() => import('@/pages/verify'), 'VerifyPage') },
  { path: '/invite', ...page(() => import('@/pages/invite'), 'InvitePage') },
  {
    element: <RequireSignIn />,
    children: [
      { index: true, element: <Home /> },
      { path: '/start', ...page(() => import('@/pages/start'), 'StartPage') },
      {
        path: '/t/:teamId',
        element: <TeamLayout />,
        children: [
          { index: true, ...page(() => import('@/pages/pit-wall'), 'PitWallPage') },
          { path: 'approvals', ...page(() => import('@/pages/approvals'), 'ApprovalsPage') },
          { path: 'approvals/:approvalId', ...page(() => import('@/pages/approvals'), 'ApprovalPage') },
          { path: 'sessions', ...page(() => import('@/pages/sessions'), 'SessionsPage') },
          { path: 'sessions/:sessionId', ...page(() => import('@/pages/session'), 'SessionPage') },
          { path: 'rules', ...page(() => import('@/pages/rules'), 'RulesPage') },
          { path: 'team', ...page(() => import('@/pages/team'), 'TeamPage') },
          { path: 'settings', ...page(() => import('@/pages/settings'), 'SettingsPage') },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];
