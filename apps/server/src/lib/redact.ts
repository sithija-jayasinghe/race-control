// Turns a hook's tool call into what Race Control may store (SPEC section 6, "Redact before storing").
//
// Two layers:
// 1. Allowlist: keep only the fields each tool needs to be understood (command, file path, URL...).
//    File contents, edits, prompts and tool output are never kept.
// 2. Scrub: replace anything that looks like a secret in what's left with [REDACTED].

export const REDACTED = '[REDACTED]';

const MAX_COMMAND = 2000;
const MAX_TEXT = 300;

type Pattern = { pattern: RegExp; replace: string | ((match: string, ...groups: string[]) => string) };

const SECRET_PATTERNS: Pattern[] = [
  // Private keys, including a block cut off by truncation.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  // Race Control's own developer tokens.
  { pattern: /\brc_[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  // Anthropic and OpenAI keys.
  { pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  // Stripe secret and restricted keys.
  { pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, replace: REDACTED },
  // GitHub tokens.
  { pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, replace: REDACTED },
  // AWS access key ids.
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  // Slack tokens.
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  // Google API keys.
  { pattern: /\bAIza[0-9A-Za-z_-]{35}/g, replace: REDACTED },
  // JSON Web Tokens.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
  // Credentials in URLs: scheme://user:password@host
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, replace: (_, scheme: string) => `${scheme}${REDACTED}@` },
  // Authorization header values.
  { pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: (_, kind: string) => `${kind} ${REDACTED}` },
  // name=value / name: value / --name value, where the name sounds secret.
  {
    pattern:
      /((?:--?)?[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth|credential)[A-Za-z0-9_.-]*)(\s*[=:]\s*|\s+)(["']?)([^\s"'&;|]+)\3/gi,
    replace: (match: string, name: string, sep: string, quote: string, value: string) => {
      // `--token` followed by another flag isn't a value; `auth/session.ts`-style paths have no separator.
      if (sep.trim() === '' && (!name.startsWith('-') || value.startsWith('-'))) return match;
      // Already redacted, an env var reference, or an auth scheme whose token was redacted above.
      if (value === REDACTED || value.startsWith('$') || /^(?:bearer|basic|token)$/i.test(value)) return match;
      return `${name}${sep}${quote}${REDACTED}${quote}`;
    },
  },
];

/** Replaces anything that looks like a secret with [REDACTED]. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    out = out.replace(pattern, replace as (substring: string, ...args: string[]) => string);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Redacts, then truncates, a free-text field. Non-strings are dropped. */
function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' ? truncate(redactSecrets(value), max) : undefined;
}

/** `/Users/nimal/...` and `/home/nimal/...` become `~/...`, so usernames aren't stored. */
export function hideHome(path: string): string {
  return path.replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '~');
}

/** A file path relative to the session's folder when it's inside it, otherwise with the home folder hidden. */
export function displayPath(path: string, cwd: string | undefined): string {
  if (cwd) {
    const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
    if (path.startsWith(base)) return path.slice(base.length);
    if (path === cwd) return '.';
  }
  return hideHome(path);
}

/** The repo a session works in: the last folder of its working directory. */
export function repoNameFromCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return name ? truncate(name, 200) : null;
}

/** URLs keep their origin and path. Query strings and fragments often carry tokens, so they go. */
function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return truncate(redactSecrets(`${url.origin}${url.pathname}`), MAX_TEXT);
  } catch {
    return cleanText(value);
  }
}

export type ToolCallRecord = {
  /** What the tool acted on: a file path for file tools, the command for Bash. Used for collisions. */
  target: string | null;
  /** One short line for feeds, e.g. "edit src/app.ts". */
  summary: string;
  /** The allowlisted, redacted fields. */
  input: Record<string, string | number | boolean>;
};

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit', 'NotebookRead']);

function compact(input: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | number | boolean
  >;
}

/** Keeps only what each tool needs to be understood, redacted. Unknown and MCP tools keep only their name. */
export function recordToolCall(toolName: string, input: Record<string, unknown>, cwd?: string): ToolCallRecord {
  const verb = toolName.toLowerCase();

  if (FILE_TOOLS.has(toolName)) {
    const rawPath = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined;
    const path = rawPath ? truncate(redactSecrets(displayPath(rawPath, cwd)), 1000) : null;
    return {
      target: path,
      summary: truncate(path ? `${verb} ${path}` : verb, 160),
      input: compact({
        file_path: path ?? undefined,
        replace_all: typeof input.replace_all === 'boolean' ? input.replace_all : undefined,
        offset: typeof input.offset === 'number' ? input.offset : undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      }),
    };
  }

  switch (toolName) {
    case 'Bash': {
      const command = typeof input.command === 'string' ? truncate(redactSecrets(input.command), MAX_COMMAND) : null;
      return {
        target: command,
        summary: truncate(`bash ${command ?? ''}`.trim().replace(/\s+/g, ' '), 160),
        input: compact({
          command: command ?? undefined,
          description: cleanText(input.description),
          run_in_background: typeof input.run_in_background === 'boolean' ? input.run_in_background : undefined,
        }),
      };
    }
    case 'Glob':
    case 'Grep': {
      const pattern = cleanText(input.pattern);
      const path = typeof input.path === 'string' ? displayPath(input.path, cwd) : undefined;
      return {
        target: path ?? null,
        summary: truncate(`${verb} ${pattern ?? ''}${path ? ` in ${path}` : ''}`.trim(), 160),
        input: compact({ pattern, path, glob: cleanText(input.glob), output_mode: cleanText(input.output_mode, 50) }),
      };
    }
    case 'WebFetch': {
      const url = cleanUrl(input.url);
      return { target: url ?? null, summary: truncate(`fetch ${url ?? ''}`.trim(), 160), input: compact({ url }) };
    }
    case 'WebSearch': {
      const query = cleanText(input.query);
      return { target: null, summary: truncate(`search ${query ?? ''}`.trim(), 160), input: compact({ query }) };
    }
    case 'Agent':
    case 'Task': {
      const description = cleanText(input.description);
      const subagent = cleanText(input.subagent_type, 100);
      return {
        target: null,
        summary: truncate(`agent ${description ?? subagent ?? ''}`.trim(), 160),
        input: compact({ description, subagent_type: subagent }),
      };
    }
    default:
      return { target: null, summary: truncate(toolName, 160), input: {} };
  }
}

/** First line of a tool error ("Exit code 1"), redacted. The rest can contain output and paths. */
export function errorHeadline(error: unknown): string | undefined {
  if (typeof error !== 'string') return undefined;
  return truncate(redactSecrets(hideHome(error.split('\n')[0] ?? '')), 200);
}
