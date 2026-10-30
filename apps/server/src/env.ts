import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  // Where the dashboard runs. Magic links point here.
  WEB_URL: z.url().default('http://localhost:5173'),
  // Where agents reach this server. The hook settings developers copy point here.
  PUBLIC_URL: z.url().default('http://localhost:4000'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only report which variables are wrong, never their values.
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }
  return result.data;
}
