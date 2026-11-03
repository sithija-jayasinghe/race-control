import { z } from 'zod';

/** Unset or blank both mean "not configured". */
const optional = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('127.0.0.1'),
  // How many proxies sit in front of the server (Render has one). Their X-Forwarded-For entry is trusted
  // for the client's IP, which rate limits are keyed on. 0 means the server is reached directly.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().min(1),
  // Where the dashboard runs. Magic links point here.
  WEB_URL: z.url().default('http://localhost:5173'),
  // Where agents reach this server. The hook settings developers copy point here.
  PUBLIC_URL: z.url().default('http://localhost:4000'),
  // The built web app (apps/web/dist). When set, this server serves the dashboard too, so WEB_URL and
  // PUBLIC_URL are the same address. Leave unset in development, where Vite serves it.
  WEB_DIST: optional,
  // Sends magic links by email (https://resend.com). Without it, links are printed to the console,
  // which is only allowed in development.
  RESEND_API_KEY: optional,
  // The sender, for example `Race Control <login@yourdomain.com>`, on a domain verified in Resend.
  EMAIL_FROM: optional,
  // Sign in with GitHub (an OAuth app) and Google (an OAuth client). Each is on only when both of its
  // values are set. Their callback URL is WEB_URL/api/auth/<github|google>/callback.
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only report which variables are wrong, never their values.
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }
  const env = result.data;
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.EMAIL_FROM)) {
    throw new Error('Invalid environment variables: set both RESEND_API_KEY and EMAIL_FROM, or neither');
  }
  for (const [id, secret] of [
    ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  ] as const) {
    if (Boolean(env[id]) !== Boolean(env[secret])) throw new Error(`Invalid environment variables: set both ${id} and ${secret}, or neither`);
  }
  if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
    throw new Error('Invalid environment variables: RESEND_API_KEY and EMAIL_FROM are required in production');
  }
  return env;
}
