import { AuthCallback } from './auth-callback';

/**
 * OAuth landing route.
 *
 * Renders the client component that exchanges the PKCE code. The exchange has to happen in
 * the browser because that is where the code verifier was stored when the flow started —
 * see `auth-callback.tsx` for the full reasoning.
 *
 * A plain page (rather than a Route Handler redirect) also means the session stays in the
 * browser client that started the flow, so the rest of the app sees it without a second hop.
 */
export default function Page() {
  return <AuthCallback />;
}
