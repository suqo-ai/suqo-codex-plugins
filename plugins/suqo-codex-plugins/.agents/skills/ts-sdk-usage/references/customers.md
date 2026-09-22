# Customers

```ts
suqo.customers.list(params?: PageParams): Promise<Page<Customer>>      // GET /api/v1/customers/
suqo.customers.autoPaging(params?: PageParams): AsyncIterableIterator<Customer>
suqo.customers.retrieve(id: number): Promise<Customer>                  // GET /api/v1/customers/{id}/
```

Read-only — no create/update/delete. A customer record is created implicitly
the first time someone subscribes; there is no separate "register a
customer" call.

## Read this before trusting any other doc about this resource

**`specs/SDK-SPEC.md` §11 and `docs/typescript-addendum.md` §6 in the SDK
repo both still describe this resource as an unimplemented stub** — the spec
says every method "throws `SuqoError(\"customers API not yet available in
this SDK version\")`". **That is stale.** The real
`src/resources/customers.ts` implements all three methods for real, hitting
the endpoints above; `test/contract/requestShape.test.ts` exercises
`list`/`retrieve` against a mock server and `test/resources/customers.test.ts`
covers `autoPaging` separately; `docs/user/customers.md` and
`examples/list-customers.ts` both describe and use it as fully working. Treat source + tests + `docs/user/` as
ground truth for this resource — the spec and addendum simply haven't caught
up to the implementation yet.

## `Customer`'s own shape

```ts
interface Customer {
  id: number;   // a plain integer — NOT a UUID, unlike every other id in the SDK
  buyerPhone: string | null;
  buyerEmail: string | null;
  fullName: string | null;
  createdAt: string;
}
```

`retrieve(id)` takes that same integer. Every other resource in this SDK
identifies records with a UUID-shaped string (`subscriptionId`, `productId`,
`pbpId`, ...); this is the one exception. Don't assume you can pass a UUID
here, and don't assume this `id` means anything outside this resource.

**A breaking change to this exact shape is already decided, just not
released yet**: the SDK's own `CHANGELOG.md` `[Unreleased]` section (as of
this writing) documents `Customer.id` moving from `number` to an opaque
`"cus_..."`-prefixed `string`, and a new `Customer.address: string | null`
field being added — both flagged there as requiring a `2.0.0`, not yet
tagged/published. The currently-published `@suqo/sdk@1.0.0` (the only
version on npm as of this writing) still has the shape above. Don't
document the `2.0.0` shape as current fact until it's actually released —
check `CHANGELOG.md`'s top-level version, not just `[Unreleased]`, before
updating this section again.

## Not the same type as the `customer` on a `Subscription`

This `Customer` record (this resource's own shape, above) is a genuinely
different type from `SubscriptionCustomer` — the object embedded under
`subscription.customer` when you call `subscriptions.list`/`create` (see
`subscriptions.md`, `models.md`). The SDK never conflates them, and neither
should generated code: don't assume a `Customer.id` shows up anywhere on a
`Subscription`, and don't assume `SubscriptionCustomer`'s fields (`phone`,
`fullName`, `billing`, `shipping`, ...) exist on `Customer` — they don't
overlap beyond `fullName`.
