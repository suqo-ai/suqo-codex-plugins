# Constructing `SuqoClient`

## Install — not yet published

`npm view @suqo/sdk` 404s against the real npm registry today. `package.json`
in the SDK repo is still `0.0.1`, and `specs/versioning.md`'s `1.0.0` row is
marked "Pending — this ticket's release," not shipped. Don't write
`npm install @suqo/sdk` as if it works — it doesn't yet. What actually works
right now:

```bash
# from inside the suqo-sdk repo
npm run build
npm pack                          # -> suqo-sdk-0.0.1.tgz

# in the consuming project
npm install /path/to/suqo-sdk-0.0.1.tgz
```

or a direct file/git dependency in `package.json` pointing at the SDK repo,
until it's actually published. Say plainly which of these you used — don't
imply a registry install happened if it didn't.

## Constructing the client

```ts
import { SuqoClient } from "@suqo/sdk";

const suqo = new SuqoClient({ apiKey: process.env.SUQO_API_KEY! });
```

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | *required* | Its prefix is the **only** thing that determines environment. |
| `baseUrl` | inferred from `apiKey` | A *check*, not a switch — see below. |
| `timeout` | `30_000` ms | Per-request; aborts and throws `NetworkError` if exceeded. |
| `maxRetries` | `2` (3 attempts total) | **Reads only.** `create`/`cancel`/`updateBillingCycle`/`resume` never retry regardless of this value. |
| `dispatcher` | none | An undici `Dispatcher`, forwarded into every `fetch()` call verbatim (real production use: a custom proxy/keep-alive agent). Not recommended for mocking in tests — see the Testing section of `SKILL.md` for why and what to use instead. |

No per-call override of `timeout`/`maxRetries`/`dispatcher` exists — construct
a second `SuqoClient` if one call genuinely needs different settings.

## Environment is inferred, never read from the environment

There is no env-var reading anywhere inside the SDK itself. `SUQO_API_KEY` (or
whatever name you pick) is something *your* code reads and passes in — the
SDK only ever sees the string you hand it.

Key prefix decides everything:

| Prefix | Environment | Base URL |
| --- | --- | --- |
| `su_test_key_` | sandbox | `https://test-be.suqo.ai` |
| `su_key_` | live | `https://be.suqo.ai` |

This inference happens entirely inside the SDK — you never write this match
yourself. Internally it checks with `String.prototype.startsWith`, and
`"su_test_key_..."` does not start with `"su_key_"` (nor contain it as a
substring), so there's no actual collision between the two prefixes to worry
about either way.

`baseUrl` is a check that can only agree or throw, exactly like PHP's
`environment:` parameter — it is never a way to redirect a key to some other
host. Both `SuqoConfigError` cases are thrown synchronously at construction,
before any request:

```
Malformed SUQO API key: expected prefix "su_key_" (live) or "su_test_key_" (sandbox).
Environment mismatch: key implies <url> but baseUrl was set to <url>. Remove baseUrl or use a matching key.
```

`SuqoConfigError` extends `SuqoError` (see `errors.md`) — it just fires at a
different time than every other error: synchronously, at construction,
before any request has been made.

## Auth header

`Authorization: Bearer <apiKey>` is attached automatically to every request.
There is **no `X-Api-Key` header** — the SDK's own docs flag this explicitly
as "an older, now-incorrect assumption worth calling out." Don't set one
yourself; it does nothing.

## The key is redacted, not just hidden

`suqo.toJSON()`, `console.log(suqo)`, and `util.inspect(suqo)` all print
`apiKey: "[redacted]"` — the key is stored non-enumerably and never surfaces
in a stringified client. Safe to log the client object itself for debugging;
never log `options.apiKey` directly.

## Reading `environment`/`baseUrl`/`timeout`/`maxRetries` back

```ts
suqo.environment  // "sandbox" | "live"
suqo.baseUrl      // e.g. "https://test-be.suqo.ai"
suqo.timeout      // ms
suqo.maxRetries
```

Useful for a startup log line or a health-check endpoint confirming which
environment a deployed instance is actually talking to.

## Framework wiring: a lazy, guarded singleton

There's no single dominant server framework in the Node ecosystem the way
Laravel is for PHP, so one small generic pattern covers Express, Next.js API
routes, Fastify, or a plain script alike — construct once, lazily, and only
once a key is actually present:

```ts
import { SuqoClient } from "@suqo/sdk";

let client: SuqoClient | undefined;

export function getSuqoClient(): SuqoClient {
  if (!client) {
    const apiKey = process.env.SUQO_API_KEY;
    if (!apiKey) {
      throw new Error("SUQO_API_KEY is not set");
    }
    client = new SuqoClient({ apiKey });
  }
  return client;
}
```

Don't construct `SuqoClient` at module load time (a top-level
`new SuqoClient(...)` in a file some unrelated script or build step ends up
importing). That's the same lesson the PHP skill's Laravel service-provider
fix encoded: resolving the client eagerly — before anything actually needs
it — turns a merely-missing key into a hard crash for commands that were
never going to touch SUQO at all. Construct lazily, on first real use,
instead. See `templates/suqo-client.ts` for the runnable version of this
pattern.
