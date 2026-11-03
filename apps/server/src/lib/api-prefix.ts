/**
 * The dashboard calls the API under `/api` on its own origin, so its cookie stays first-party. In
 * development Vite strips the prefix before proxying; in production the server is that origin and
 * strips it itself. Agents call `/hooks/...` without it, and both forms reach the same routes.
 */
export function stripApiPrefix(url: string): string {
  if (url !== '/api' && !url.startsWith('/api/') && !url.startsWith('/api?')) return url;
  const rest = url.slice('/api'.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}
