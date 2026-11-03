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
  DATABASE_URL: z.string().min(1),
  // Where the dashboard runs. Magic links point here.
  WEB_URL: z.url().default('http://localhost:5173'),
  // Where agents reach this server. The hook settings developers copy point here.
  PUBLIC_URL: z.url().default('http://localhost:4000'),
  // Sends magic links by email (https://resend.com). Without it, links are printed to the console,
  // which is only allowed in development.
  RESEND_API_KEY: optional,
  // The sender, for example `Race Control <login@yourdomain.com>`, on a domain verified in Resend.
  EMAIL_FROM: optional,
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
  if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
    throw new Error('Invalid environment variables: RESEND_API_KEY and EMAIL_FROM are required in production');
  }
  return env;
}
