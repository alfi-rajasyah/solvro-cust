import { OAuth2Client } from "google-auth-library";
import { prisma } from "./prisma.js";

// In-process cache for the AuthConfig singleton + a memoised OAuth2Client
// keyed off the current googleClientId. Reads happen on every Google sign-in;
// the row itself rarely changes (admin-edited). TTL of 30s balances "no
// per-request DB hit" against "admin edits propagate quickly". Bust the cache
// from the admin PATCH route for instant effect.
const TTL_MS = 30_000;

interface CacheValue {
  googleClientId: string | null;
  googleAllowedDomains: string[];
  updatedAt: Date;
  googleClient: OAuth2Client | null;
}

interface CacheEntry {
  value: CacheValue;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export async function getAuthConfigCached(): Promise<CacheValue> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const row = await prisma.authConfig.findUniqueOrThrow({
    where: { id: "default" },
    select: {
      googleClientId: true,
      googleAllowedDomains: true,
      updatedAt: true,
    },
  });
  const value: CacheValue = {
    ...row,
    googleClient: row.googleClientId ? new OAuth2Client(row.googleClientId) : null,
  };
  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

export function bustAuthConfigCache(): void {
  cache = null;
}
