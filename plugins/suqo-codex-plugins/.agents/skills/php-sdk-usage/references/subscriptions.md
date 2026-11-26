# Subscriptions

Ten operations: `list`, `autoPaging`, `create`, `read`, `cancel`, `resume`,
`renew`, `updateBillingCycle`, `changePreview`, `change`. Signatures in
`api-surface.md`.

## The checkout flow

1. Pick a plan billing point (`pbp_…`). It comes from a product's plan — see
   `products.md`.
2. `create()` with the buyer's details and your `returnUrl`.
3. Send the buyer to the checkout URL the server returns, then handle the
   webhook (`references/webhooks.md`) rather than polling.

```php
use Suqo\Params\CreateSubscriptionParams;
use Suqo\Params\CustomerBilling;
use Suqo\Params\CustomerInput;
use Suqo\Params\CustomerShipping;

$created = $suqo->subscriptions->create(new CreateSubscriptionParams(
    pbpId: 'pbp_3n9k2x',
    customer: new CustomerInput(
        phone: '9841000100',
        fullName: 'Ram Shrestha',
        email: 'ram@client.com',
        address: 'Kathmandu, Nepal',
        billing: new CustomerBilling(
            billingBusinessName: 'ABC Pvt Ltd.',
            billingEmail: 'ram@client.com',
            billingAddress: 'Kathmandu, Nepal',
            billingPanVat: '9841000100',
        ),
        shipping: new CustomerShipping(
            phone: '9841000100',
            fullName: 'Ram Shrestha',
            email: 'ram@client.com',
        ),
    ),
    returnUrl: 'https://merchant.example.com/thanks',
));
```

`create()` returns `CreateSubscriptionResponse` with `pbpId`, `returnUrl` and
`customer` — the API declares the 201 body as the same schema as the request, so
it echoes what was sent. **There is no typed `subscriptionId` or checkout URL on
the response.** Anything the server adds beyond the declared schema comes back
through `toArray()`:

```php
$checkoutUrl = $created->toArray()['checkout_url'] ?? null;   // key per your API contract

if ($checkoutUrl === null) {
    // Do not fabricate a URL. Log the raw body and fail loudly.
    throw new RuntimeException('SUQO create returned no checkout URL: '
        . json_encode($created->toArray()));
}
```

`$created->customer` is `Params\CustomerInput` — the write shape read back, not
the embedded read shape a subscription record carries.

## Wire names when a create fails

`ValidationError::$fieldErrors` is keyed by **wire** name. Map before showing
anything to a user:

| Wire key in the error | What you passed |
| --- | --- |
| `pbp_id` | `pbpId` |
| `client` | `customer` |
| `client.full_name` | `customer->fullName` |
| `client.billing.billing_email` | `customer->billing->billingEmail` |
| `return_url` | `returnUrl` |

Inspect the exact body you are about to send, without a request:

```php
echo json_encode($params->toWire(), JSON_PRETTY_PRINT);
```

## The error ladder for a create

```php
use Suqo\Exception\KycRequiredError;
use Suqo\Exception\SuqoError;
use Suqo\Exception\ValidationError;

try {
    $created = $suqo->subscriptions->create($params);
} catch (ValidationError $e) {
    foreach ($e->fieldErrors as $field => $messages) {
        // $field is a wire name
        $errors[$field] = $messages;
    }
} catch (KycRequiredError $e) {
    // Merchant onboarding incomplete — not the buyer's fault.
    // $e->kycStatus is the wire `status_code`.
} catch (SuqoError $e) {
    error_log("suqo {$e->status} req={$e->requestId}: {$e->getMessage()}");
}
```

**Writes are not retried.** A `NetworkError` from `create()` means the
subscription may or may not have been created. Do not resend blindly: record
your own idempotency marker before the call, and reconcile against
`subscriptions->list()` afterwards.

## Listing

```php
$page = $suqo->subscriptions->list(pageSize: 50);

echo $page->totalSubscriptions, ' / ', $page->activeSubscriptions, PHP_EOL;

foreach ($page->results as $subscription) {
    echo $subscription->subscriptionId, ' ', $subscription->customer?->email, PHP_EOL;
    echo '  ', $subscription->product?->price, ' ', $subscription->product?->currency, PHP_EOL;
    echo '  next billing ', $subscription->nextBillingCycle, PHP_EOL;
}
```

`SubscriptionPage` adds four `?int` counters: `totalSubscriptions`,
`activeSubscriptions`, `dueSubscriptions`, `inactiveSubscriptions`. They live on
the page, so **`autoPaging()` cannot see them** — call `list()` when you need a
dashboard total.

There is no server-side filter or search parameter, and no single-subscription
read. To find one subscription, iterate:

```php
foreach ($suqo->subscriptions->autoPaging(pageSize: 100) as $subscription) {
    if ($subscription->subscriptionId === $id) {
        return $subscription;
    }
}
```

That is O(n) over the account. For anything hot, persist the records you care
about locally and keep them fresh from webhooks — do not put a full scan in a
request path.

## Status

```php
use Suqo\Model\SubscriptionStatus;

$status = $subscription->status;   // SubscriptionStatus|string|null

if ($status instanceof SubscriptionStatus) {
    match ($status) {
        SubscriptionStatus::Active              => $this->activate($subscription),
        SubscriptionStatus::Due                 => $this->chase($subscription),
        SubscriptionStatus::PendingCheckout     => null,
        SubscriptionStatus::PendingCancellation => $this->windDown($subscription),
        SubscriptionStatus::Cancelled,
        SubscriptionStatus::Inactive            => $this->deactivate($subscription),
    };
} else {
    // A status added server-side, or absent. Log; do not throw.
    error_log('unrecognised SUQO status: ' . var_export($status, true));
}
```

Always narrow with `instanceof` first. A bare `match ($subscription->status)`
will throw `\UnhandledMatchError` the first time the API adds a status.

`isActive` is a separate `?bool` and is the cheaper check when all you need is a
gate.

## Cancelling

```php
$result = $suqo->subscriptions->cancel('3fa85f64-5717-4562-b3fc-2c963f66afa6');

echo $result->message;
```

No request body is sent and no `Content-Type` header is set. A 404 means the id
is unknown to **this environment** — a live id against a test key looks exactly
like a missing one.

## Reading one subscription

```php
$subscription = $suqo->subscriptions->read('3fa85f64-5717-4562-b3fc-2c963f66afa6');
```

There is still no server-side filter or search parameter on `list()` — `read()`
is the way to fetch one subscription by id directly instead of scanning
`autoPaging()` for it. Throws `NotFoundError` on 404, same environment caveat
as `cancel()`.

## Resuming

```php
$result = $suqo->subscriptions->resume('3fa85f64-5717-4562-b3fc-2c963f66afa6');

echo $result->message;
```

Undoes a scheduled cancellation and returns the subscription to active. An
already-active subscription is returned unchanged, so this is safe to retry by
hand. A subscription that is already fully cancelled cannot be resumed — that
is a 400 with a bare list of messages, surfaced as the message on a
`ValidationError`. No request body is sent, same as `cancel()`.

## Renewing

```php
use Suqo\Model\CheckoutSession;

$session = $suqo->subscriptions->renew('3fa85f64-5717-4562-b3fc-2c963f66afa6');

echo $session->checkoutUrl, PHP_EOL;   // send this to the buyer
```

Opens a checkout session for the next payment on one of your own
subscriptions, reusing its existing customer and billing period rather than
resubmitting them. Returns a `CheckoutSession` (`publicId`, `expiresAt`,
`checkoutUrl`) — see `checkout-sessions.md`.

Takes the subscription id as a plain string, like `cancel()` and `resume()`,
not a params object — the id travels in the body, not the path, and the route
is the singular `/subscription/renew/`. A cancelled or archived subscription,
and a paid one-time purchase, cannot be renewed.

Nothing on the `Subscription` record says whether it recurs: match
`$subscription->product->pbpId` against `products->list()` and read that
billing period's `intervalType` — `one_time` means the subscription can be
neither cancelled, resumed nor rescheduled.

## Changing the plan

```php
use Suqo\Params\PlanChangeParams;

$quote = $suqo->subscriptions->changePreview(
    '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    PlanChangeParams::billingPeriod('pbp_7h2m4q'),
);

echo $quote->type, ' ', $quote->amountDue, ' NPR, expires ', $quote->newExpiryDate, PHP_EOL;

// Happy with the quote — apply the identical change.
$result = $suqo->subscriptions->change(
    '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    PlanChangeParams::billingPeriod('pbp_7h2m4q'),
);

if ($result->checkoutUrl !== null) {
    echo 'collect ', $result->amountDue, ' NPR at ', $result->checkoutUrl, PHP_EOL;
}
```

`changePreview()` quotes what moving onto another price would cost — it
**changes nothing**. `change()` takes identical parameters and applies the
move. Both return the same `Suqo\Model\PlanChangeQuote`.

The target is **either** one of your own prices, or an inline one you set
here — never a mix, same rule as a checkout item — via `PlanChangeParams`'s two
named constructors:

```php
PlanChangeParams::billingPeriod('pbp_7h2m4q');

PlanChangeParams::inline(
    name: 'Pro custom',
    amount: '1500',                      // decimal string, minimum 50
    intervalType: Suqo\IntervalType::Month,
    intervalCount: 1,                    // one_time is refused here
);
```

Moving onto an inline price **detaches the subscription from its product**,
and VAT is added to the amount from your account's settings.

`PlanChangeQuote`: `type` (`upgrade`, `downgrade` or `lateral` — same daily
cost, nothing owed, expiry unchanged), `basis` (`last_payment`, or
`current_price` when no payment record was found), `currentDailyRate` /
`newDailyRate` (decimal strings, four places), `remainingDays` (`?int`),
`amountDue` (`?int`, whole NPR with VAT inside, non-zero only on an upgrade,
minimum 50), `daysAdded` (`?int`, what a downgrade or a minimum-charge upgrade
adds), `newExpiryDate` (`Y-m-d`), `checkoutSessionId` / `checkoutUrl`.

- **A downgrade or a free switch applies now** (via `change()`):
  `checkoutSessionId` and `checkoutUrl` stay `null`.
- **An upgrade returns a checkout.** Send `checkoutUrl` to the buyer; the plan
  switches once they pay, and the link expires after 30 minutes. If the
  subscription is cancelled, expires or changes plan before the payment
  settles, or a payment already taken leaves the plan as it is, the link stops
  accepting payment.

**Throws** `ValidationError` on 400 (an inline field beside a `pbp_id`, a
missing inline field, an amount under 50, an interval out of range or
`one_time`), `NotFoundError` on 404 (the subscription, or a `pbp_id` that is
not yours). A plan that **cannot** change (the same price, expired, unpaid,
cancelled, the target unavailable, or a change payment already pending)
answers **422** — no dedicated exception class, so it surfaces as a base
`SuqoError` (concretely `ServerError`) whose `status` is `422` and whose
message is the server's `detail`. Neither method is retried — both are
writes, and a second `change()` while an upgrade payment is pending also
answers 422.

## Moving the billing cycle

```php
use Suqo\Params\UpdateBillingCycleParams;

$suqo->subscriptions->updateBillingCycle(new UpdateBillingCycleParams(
    subscriptionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    nextBillingCycle: '2026-09-03',        // YYYY-MM-DD, a string
));
```

The id travels in the body, not the path. `nextBillingCycle` stays a string —
format a `DateTimeInterface` yourself:

```php
nextBillingCycle: $date->format('Y-m-d'),
```

## Sending a field the SDK does not type

Every params object takes `extra`, merged into the body verbatim under wire
names. A declared key always wins over an `extra` key of the same name.

```php
new UpdateBillingCycleParams(
    subscriptionId: $id,
    nextBillingCycle: '2026-09-03',
    extra: ['reason' => 'customer request'],
);
```

## Record shape

`Subscription`: `subscriptionId`, `status`, `isActive` (`?bool`), `customer`
(`?SubscriptionCustomer`, wire `client`), `product` (`?SubscriptionProduct`),
`currentPeriodStart`, `currentPeriodEnd`, `nextBillingCycle`, `createdAt`.

`SubscriptionProduct`: `productId`, `name`, `planName`, `pbpId`, `label`,
`price` (decimal **string**), `currency`.

`SubscriptionCustomer`: `phone`, `fullName`, `email`, `address`, `billing`,
`shipping`. The read shape drops the `billing_` prefix the write shape carries —
you send `billingBusinessName`, you read `businessName`.

Full property tables in `models.md`.
