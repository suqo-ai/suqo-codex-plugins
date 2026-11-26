# Checkout sessions

`$suqo->checkoutSessions` — two operations: `create`, `read`. Signatures in
`api-surface.md`.

A session collects **one payment** for up to ten of your own billing periods,
or for lines you price yourself — the route to a payment that is not a
subscription. A subscription's first payment comes from
`subscriptions->create()`, and its next from `subscriptions->renew()` — both
hand back a checkout URL of their own, through this same `CheckoutSession`
shape.

## Creating a session

```php
use Suqo\Params\CheckoutItem;
use Suqo\Params\CreateCheckoutSessionParams;

$session = $suqo->checkoutSessions->create(new CreateCheckoutSessionParams(
    items: [CheckoutItem::billingPeriod('pbp_3n9k2x')],
    returnUrl: 'https://partner.example.com/orders/1234',
));

echo $session->checkoutUrl, PHP_EOL;   // send this to the buyer
echo $session->expiresAt, PHP_EOL;
```

`items` takes 1–10 entries, `returnUrl` is required, `customerId` is optional
— omitted or `null` lets the buyer identify themselves by OTP at checkout;
passing one requires a customer that already exists on your account (see
`customers.md`). The SDK sends `customer_id` only when you set it.

## The two item shapes

An item is **either** an existing billing period **or** an inline,
partner-priced line — never a mixture. The API rejects any inline field sent
beside a `pbp_id`, because the plan behind a billing period sets the price,
the cadence and the discount. `CheckoutItem` has one named constructor per
shape — no public constructor — so the invalid combination cannot be
expressed:

```php
use Suqo\IntervalType;

CheckoutItem::billingPeriod('pbp_3n9k2x');

CheckoutItem::inline(
    name: 'Setup fee',
    amount: '2500.00',                  // a decimal string, never a float
    intervalType: IntervalType::OneTime,
    intervalCount: 0,                   // must be 0 for one_time
    discountAmount: '500.00',           // optional
);
```

`intervalCount` is bounded per unit: 1–1095 for `day`, 1–156 for `week`, 1–36
for `month`, 1–3 for `year`, and exactly `0` for `one_time`. `intervalType`
accepts an `IntervalType` case or a raw wire string.

Each item's price is **snapshotted when the session opens** — editing the plan
afterwards cannot change what the buyer already saw. If two items resolve to
the same product, only the last one survives.

## Rate limit

`create` is rate-limited — 20 sessions a minute per account by default. It is
not the only rate-limited call: bank-account `update()`/`sendOtp()` and the
BYOP writes are too. Over
that, the API answers `429` and the SDK raises `RateLimitError` with
`retryAfter` set from the response header:

```php
use Suqo\Exception\RateLimitError;

try {
    $session = $suqo->checkoutSessions->create($params);
} catch (RateLimitError $e) {
    sleep((int) ceil($e->retryAfter ?? 1.0));
}
```

**It is not retried for you.** Creating a session is a write; back off and
resend yourself, deliberately — a blind resend would open a second session.

`create` also throws `ValidationError` on 400 (an item, the customer or the
return URL was rejected), `AuthenticationError` on 401, `KycRequiredError` /
`PermissionDeniedError` on 403.

## Reading a session back

```php
use Suqo\Exception\NotFoundError;

try {
    $detail = $suqo->checkoutSessions->read($session->publicId);
} catch (NotFoundError $e) {
    $returnUrl = is_array($e->rawBody) ? ($e->rawBody['return_url'] ?? '') : '';
}
```

**Only an open session is served.** Once it is paid, or once `expiresAt` has
passed, this answers 404 exactly as an unknown id does — a `NotFoundError`
here is usually the ordinary end of a session's life, not a mistake. When the
session existed, that 404 carries its `return_url` beside the message on
`$error->rawBody` (wire names, so `return_url` there, not `returnUrl`) — enough
to send the buyer onwards even once the session itself is gone. `fieldErrors`
stays empty; it is populated only for a 400.

## Record shape — `CheckoutSessionDetail`

`publicId` (`cks_…`), `lineItems` (untyped `array`, kept exactly as it
arrived — openapi describes the container without its members, so there is
nothing to type), `customerId` (`?string`, null when the buyer identified by
OTP), `sellerDetails` (`?CheckoutSeller`: `id`, `phone`, `businessLogo`,
`businessName`), `returnUrl`, `expiresAt`, `completedAt` (null while open),
`isExpired` (`?bool`).

`checkoutSessions->create()` and `subscriptions->renew()` return the lighter
`CheckoutSession` instead: `publicId`, `expiresAt`, `checkoutUrl`.
