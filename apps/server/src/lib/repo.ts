import { hideHome, repoNameFromCwd } from './redact.ts';

// Which repo an agent is working in (SPEC section 4). Two clones of the same repo match by their git
// remote, whatever their folders are called. Without a remote, the folder name is all there is.

/** A repo as Race Control matches it. */
export type RepoContext = {
  /** For matching: `github.com/org/api`, or `local:<folder>` without a remote. */
  key: string;
  /** For people: `api`. */
  name: string;
  /** The repo's top folder, home hidden. Null when only the folder name is known. */
  root: string | null;
};

const MAX_ROOT = 1000;
const SAFE_PART = /^[\w.~-]+$/;

/**
 * `github.com/org/api` from any form of git remote: `git@github.com:org/api.git`,
 * `https://user:token@github.com/org/api`, `ssh://git@github.com:22/org/api`. Credentials and ports are
 * dropped and never returned. Local paths and anything unusual give null.
 */
export function repoFromRemote(remote: string | undefined): { key: string; name: string } | null {
  const raw = remote?.trim();
  if (!raw || raw.length > 2000) return null;

  let host: string;
  let path: string;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol === 'file:') return null;
    host = url.hostname;
    path = url.pathname;
  } else {
    // scp-style, `git@github.com:org/api.git`. A Windows path like `C:\repo` doesn't fit the parts check below.
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(raw);
    if (!scp) return null;
    host = scp[1]!;
    path = scp[2]!;
  }

  const parts = path
    .replace(/\.git\/?$/i, '')
    .split('/')
    .filter(Boolean);
  if (!host || parts.length === 0 || ![host, ...parts].every((p) => SAFE_PART.test(p))) return null;
  return { key: `${host}/${parts.join('/')}`.toLowerCase().slice(0, 300), name: parts.at(-1)!.slice(0, 200) };
}

const trimSlashes = (path: string) => path.replace(/[\\/]+$/, '');

/** Whether `path` is `root` or inside it. Both are compared with the home folder hidden. */
export function isInside(path: string, root: string): boolean {
  const p = trimSlashes(hideHome(path));
  const r = trimSlashes(hideHome(root));
  return p === r || p.startsWith(`${r}/`) || p.startsWith(`${r}\\`);
}

/** The folder-name fallback: what Race Control did before it knew about remotes. */
export function repoFromCwd(cwd: string | undefined): RepoContext | null {
  const name = repoNameFromCwd(cwd);
  return name ? { key: `local:${name}`, name, root: null } : null;
}

/**
 * The repo from what the session hook sends: the git top folder and remote. Ignored unless the agent's
 * folder is inside that top folder, so a stray or mistaken header can't move a session into another repo.
 */
export function repoFromHeaders(root: string | undefined, remote: string | undefined, cwd: string | undefined): RepoContext | null {
  const top = root?.trim() ? trimSlashes(hideHome(root.trim())) : '';
  if (!top || top.length > MAX_ROOT || !cwd || !isInside(cwd, top)) return null;
  const fromRemote = repoFromRemote(remote);
  if (fromRemote) return { ...fromRemote, root: top };
  const folder = repoNameFromCwd(top)!;
  return { key: `local:${folder}`, name: folder, root: top };
}

/** The repo one event is in: the session's, while the agent is inside it, otherwise its folder name. */
export function eventRepo(session: RepoContext | null, cwd: string | undefined): RepoContext | null {
  if (session?.root && cwd && isInside(cwd, session.root)) return session;
  return repoFromCwd(cwd);
}

/** `api` from `github.com/org/api` or `local:api`. */
export function repoNameFromKey(key: string): string {
  return key.startsWith('local:') ? key.slice('local:'.length) : (key.split('/').at(-1) ?? key);
}
