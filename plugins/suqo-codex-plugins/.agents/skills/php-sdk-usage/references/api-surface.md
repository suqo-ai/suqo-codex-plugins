# SUQO PHP SDK — exact API surface

Every callable signature, verbatim. If something is not here, it does not exist —
say so rather than inventing it.

Namespace `Suqo\`, PSR-4. PHP 8.1+.

## `Suqo\SuqoClient`

```php
public function __construct(
    ?string $apiKey = null,                       // else $SUQO_API_KEY
    Environment|string|null $environment = null,  // a check, never an override
    ?float $timeout = null,                       // seconds, default 30.0, must be > 0
    ?int $maxRetries = null,                      // default 2, must be >= 0
    LogLevel|string|null $logLevel = null,        // else $SUQO_LOG, else 'warn'
    ?HttpClientInterface $httpClient = null,      // default new CurlHttpClient()
)                                                 // throws SuqoConfigError

public static function verifyWebhook(
    string $rawBody,
    ?string $signature,
    ?string $timestamp,
    string $secret,
    int $maxAge = 300,
): bool
```

Readonly properties: `config` (`Config`), `products`, `subscriptions`,
`customers`, `checkoutSessions`, `webhooks`, `payouts`, `bankAccounts`, `byop`.
The transport is private — there is no `request()` on the client.

## `Suqo\Resource\Products`

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Page          // Page<Product>; GET /api/v1/products/

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator     // Generator<int, Product>
```

## `Suqo\Resource\Subscriptions`

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): SubscriptionPage                     // GET /api/v1/subscriptions/

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator                            // Generator<int, Subscription>

public function create(
    CreateSubscriptionParams $params,
    ?Cancellation $cancellation = null,
): CreateSubscriptionResponse           // POST /api/v1/subscriptions/

public function cancel(
    string $id,
    ?Cancellation $cancellation = null,
): MessageResponse                      // POST /api/v1/subscriptions/{id}/cancel/

public function updateBillingCycle(
    UpdateBillingCycleParams $params,
    ?Cancellation $cancellation = null,
): MessageResponse                      // POST /api/v1/subscriptions/update-billing-cycle/

public function read(
    string $id,
    ?Cancellation $cancellation = null,
): Subscription                         // GET /api/v1/subscriptions/{id}/

public function resume(
    string $id,
    ?Cancellation $cancellation = null,
): MessageResponse                      // POST /api/v1/subscriptions/{id}/resume/

public function renew(
    string $subscriptionId,
    ?Cancellation $cancellation = null,
): CheckoutSession                      // POST /api/v1/subscription/renew/ (singular route)

public function changePreview(
    string $id,
    PlanChangeParams $params,
    ?Cancellation $cancellation = null,
): PlanChangeQuote                      // POST /api/v1/subscriptions/{id}/change-preview/ — changes nothing

public function change(
    string $id,
    PlanChangeParams $params,
    ?Cancellation $cancellation = null,
): PlanChangeQuote                      // POST /api/v1/subscriptions/{id}/change/ — applies it
```

All ten throw `Suqo\Exception\SuqoError` or a subclass. `list`, `autoPaging`
and `read` are retried on 0/429/5xx; the seven writes (`create`, `cancel`,
`updateBillingCycle`, `resume`, `renew`, `changePreview`, `change`) are not
retried at all.

`resume()` undoes a scheduled cancellation; an already-active subscription is
returned unchanged, so it is safe to retry by hand. A fully-cancelled
subscription cannot be resumed — that is a 400 with a bare list of messages,
surfaced as the message on a `ValidationError`.

`renew()` opens a checkout session for an existing subscription's next
payment, reusing its customer and billing period. It takes the subscription id
as a plain string (the id travels in the body, not the path) and returns a
`CheckoutSession` — send its `checkoutUrl` to the buyer. A cancelled or
archived subscription, and a paid one-time purchase, cannot be renewed.

Nothing on `Subscription` says whether it recurs. Match
`$subscription->product->pbpId` against `products->list()` and read that
billing period's `intervalType`: `one_time` means the subscription can be
neither cancelled, resumed nor rescheduled.

`changePreview()` quotes what moving onto another price would cost (an
upgrade) or add (a downgrade) **without changing anything**; `change()` takes
the identical parameters and applies it. The target is **either** one of your
own prices (`PlanChangeParams::billingPeriod($pbpId)`) **or** an inline price
(`PlanChangeParams::inline(...)`, which detaches the subscription from its
product and is refused for `one_time`) — never a mix, same rule as a checkout
item. A downgrade or a free switch applies immediately (`checkoutSessionId`
and `checkoutUrl` stay `null`); an upgrade comes back with a `checkoutUrl` —
the plan switches once the buyer pays there, and the link expires after 30
minutes. A plan that **cannot** change (same price, expired, unpaid,
cancelled, the target unavailable, or a change payment already pending)
answers `422` with a `detail` — no exception class is dedicated to 422, so it
surfaces as a base `SuqoError` (concretely `ServerError`) whose `status` is
`422` and whose message is that `detail`.

## `Suqo\Resource\Customers`

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Page                                  // Page<Customer>; GET /api/v1/customers/

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator                             // Generator<int, Customer>

public function read(
    string $id,
    ?Cancellation $cancellation = null,
): Customer                              // GET /api/v1/customers/{public_id}/

public function create(
    CustomerCreateParams $params,
    ?Cancellation $cancellation = null,
): Customer                              // POST /api/v1/customers/

public function update(
    string $id,
    CustomerUpdateParams $params,
    ?Cancellation $cancellation = null,
): Customer                              // PATCH /api/v1/customers/{public_id}/
```

All five throw `Suqo\Exception\SuqoError` or a subclass; `list`, `autoPaging`
and `read` are retried on 0/429/5xx, `create` and `update` are not. `create` is
an **upsert** — an email or phone already on the account corrects that
customer and answers `200` rather than `201`, which is what makes it safe to
retry. Full semantics, including the `null` vs `''` distinction on `update`, in
`customers.md`.

A customer record is also created implicitly the first time someone
subscribes, through `subscriptions->create()`'s `customer` field; `create()`
records one without opening a subscription.

## `Suqo\Resource\CheckoutSessions`

A session collects one payment for up to ten of your own billing periods, or
for lines you price yourself — the path to a payment that is not a
subscription. `subscriptions->create()` opens one implicitly for a
subscription's first payment, and `subscriptions->renew()` for its next.

```php
public function create(
    CreateCheckoutSessionParams $params,
    ?Cancellation $cancellation = null,
): CheckoutSession                       // POST /api/v1/checkout-sessions/

public function read(
    string $id,
    ?Cancellation $cancellation = null,
): CheckoutSessionDetail                 // GET /api/v1/checkout-sessions/{public_id}/
```

`create` is rate-limited — 20 sessions a minute per account by default (the
bank-account `update()`/`sendOtp()` and BYOP writes are rate-limited too), answered with a `429` and so a `RateLimitError`. It is a
write, so the SDK does not retry it; back off and resend yourself. `read` is
retried on 0/429/5xx.

`read` only serves an **open** session: one that has been paid, or whose
`expiresAt` has passed, answers `404` exactly like an unknown id — so a
`NotFoundError` here is the ordinary end of a session's life, not necessarily a
mistake. When the session existed, that `404` carries its `return_url` beside
the message, reachable as `$error->rawBody['return_url']`.

## `Suqo\Resource\Webhooks` — management, not verification

Registers and edits the endpoints SUQO delivers to. Unrelated to
`Webhook::verify()` (verifies an inbound delivery; no client, no API key, no
network) — the two meet at `secret()`, whose `signingSecret` is what
`verify()` takes.

```php
public function list(?Cancellation $cancellation = null): array             // list<WebhookEndpoint>; GET /api/v1/webhooks/ — the one unpaginated collection, a bare array

public function create(
    WebhookParams $params,
    ?Cancellation $cancellation = null,
): WebhookEndpoint                       // POST /api/v1/webhooks/

public function read(
    string $id,
    ?Cancellation $cancellation = null,
): WebhookEndpoint                       // GET /api/v1/webhooks/{id}/

public function replace(
    string $id,
    WebhookParams $params,
    ?Cancellation $cancellation = null,
): WebhookEndpoint                       // PUT /api/v1/webhooks/{id}/ — both fields required, whole-record overwrite

public function update(
    string $id,
    WebhookUpdateParams $params,
    ?Cancellation $cancellation = null,
): WebhookEndpoint                       // PATCH /api/v1/webhooks/{id}/ — only the fields you set

public function delete(
    string $id,
    ?Cancellation $cancellation = null,
): void                                  // DELETE /api/v1/webhooks/{id}/ — 204, nothing to return

public function secret(?Cancellation $cancellation = null): SigningSecret   // GET /api/v1/webhooks/secret/ — minted on first read, not rotatable here

public function testDelivery(
    string $id,
    ?Cancellation $cancellation = null,
): DetailResponse                        // POST /api/v1/webhooks/{id}/test-delivery/ — 202, enqueued only; says nothing about whether your endpoint accepted it
```

An account holds at most one webhook per event (`Suqo\Model\WebhookEvent`).
`replace` is named for what PUT does — both `event` and `endpointUrl` are
required and a field left off `WebhookParams` is not preserved; `update` is
the one-field change. All eight throw `Suqo\Exception\SuqoError` or a
subclass; only `list`, `read` and `secret` are retried.

## `Suqo\Resource\Payouts`

A payout moves every transaction currently due to your verified bank account,
less gateway fees, the platform fee and unbilled SMS usage. The bank account
itself is managed through `Suqo\Resource\BankAccounts`, below.

```php
public function list(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Page                                  // Page<Payout>; GET /api/v1/payouts/ — newest first

public function autoPaging(
    ?int $page = null,
    ?int $pageSize = null,
    ?Cancellation $cancellation = null,
): Generator                             // Generator<int, Payout>

public function create(?Cancellation $cancellation = null): Payout   // POST /api/v1/payouts/ — no body; request everything due

public function read(
    string $id,
    ?Cancellation $cancellation = null,
): Payout                                // GET /api/v1/payouts/{public_id}/
```

All four throw `Suqo\Exception\SuqoError` or a subclass; `list`, `autoPaging`
and `read` are retried on 0/429/5xx, `create` is not. Only one payout may be
pending at a time, so a repeat `create()` after a success answers `400` rather
than paying twice — `ValidationError::$fieldErrors['code'][0]` names the
reason (`pending_payout_request_exists`, `bank_account_not_found`,
`bank_account_not_verified`, `no_transactions_due`, `payout_below_minimum`).

## `Suqo\Resource\BankAccounts`

The account payouts are paid to — one per seller. An account starts
**unverified**: `sendOtp()` emails a 6-digit code to the seller (not the
caller), and `update()` with that code verifies it. A payout needs a verified
account.

```php
public function list(?Cancellation $cancellation = null): array            // list<BankAccount>; GET /api/v1/bank-accounts/ — not paginated, a bare array

public function create(
    BankAccountParams $params,
    ?Cancellation $cancellation = null,
): BankAccount                           // POST /api/v1/bank-accounts/ — starts unverified

public function read(
    int $id,
    ?Cancellation $cancellation = null,
): BankAccount                           // GET /api/v1/bank-accounts/{id}/ — note: int id, not a prefixed public id

public function update(
    int $id,
    BankAccountUpdateParams $params,
    ?Cancellation $cancellation = null,
): BankAccount                           // PATCH /api/v1/bank-accounts/{id}/ — verifies with the OTP code; every edit needs a fresh one

public function delete(
    int $id,
    ?Cancellation $cancellation = null,
): void                                  // DELETE /api/v1/bank-accounts/{id}/ — 204; refused while a payout to it is pending

public function sendOtp(
    int $id,
    ?Cancellation $cancellation = null,
): DetailResponse                        // POST /api/v1/bank-accounts/{id}/send-otp/ — no body; 10-minute code
```

All six throw `Suqo\Exception\SuqoError` or a subclass; only `list` and `read`
are retried. `update()`'s `code` is required on every call; `bankName`,
`accountName`, `accountNumber`, `branch` are optional and only what you set is
sent. `RateLimitError` on 429 from `update()` and `sendOtp()` — code attempts
are throttled.

## `Suqo\Resource\Byop` — bring your own payment

On a BYOP account a payment method collects into your own gateway account
rather than SUQO's. Switching an account to BYOP is done by SUQO, not through
this API; until it is, `updateCredentials()` and `updateFee()` answer `403`
with `Your own payment account isn't enabled.`

```php
public function paymentMethods(?Cancellation $cancellation = null): array   // list<PaymentMethod>; GET /api/v1/byop/payment-methods/ — not paginated, hidden methods included

public function updateCredentials(
    string $paymentTypeId,
    ByopCredentialsParams $params,
    ?Cancellation $cancellation = null,
): DetailResponse                        // PATCH /api/v1/byop/credentials/{payment_method_id}/ — replaces the full credential set

public function updateFee(
    string $paymentTypeId,
    ByopFeeParams $params,
    ?Cancellation $cancellation = null,
): ByopFee                               // PATCH /api/v1/byop/fees/{payment_method_id}/
```

All three throw `Suqo\Exception\SuqoError` or a subclass; only
`paymentMethods` is retried. `paymentTypeId` (a UUID) comes from
`paymentMethods()`. `updateCredentials()` never returns the credentials back —
read `isVerified` on a later `paymentMethods()` call to confirm the gateway
accepted them. `updateFee()` is refused (`ValidationError`) for Khalti and
NPS, which report their own fee on each payment.

## Params objects — `Suqo\Params\*`

All take named arguments and end with `array $extra = []`, merged into the body
under wire names verbatim (a declared key always wins over an `extra` key).
`toWire(): array` is public, so the exact body can be inspected without a
request.

```php
new CreateSubscriptionParams(
    string $pbpId,                       // wire pbp_id
    CustomerInput $customer,             // wire client
    ?string $returnUrl = null,           // wire return_url, omitted when null
    array $extra = [],
)

new CustomerInput(
    string $phone,                       // wire phone
    string $fullName,                    // wire full_name
    string $email,                       // wire email
    ?string $address = null,             // omitted when null
    ?CustomerBilling $billing = null,    // omitted when null
    ?CustomerShipping $shipping = null,  // omitted when null
    array $extra = [],
)

new CustomerBilling(
    string $billingBusinessName,         // wire billing_business_name
    string $billingEmail,                // wire billing_email
    string $billingAddress,              // wire billing_address
    ?string $billingPanVat = null,       // wire billing_pan_vat, omitted when null
    array $extra = [],
)

new CustomerShipping(
    string $phone,
    string $fullName,
    string $email,
    ?string $address = null,
    array $extra = [],
)

new UpdateBillingCycleParams(
    string $subscriptionId,              // wire subscription_id
    string $nextBillingCycle,            // wire next_billing_cycle, "YYYY-MM-DD"
    array $extra = [],
)

new CustomerCreateParams(
    string $email,                       // the only required field
    ?string $phone = null,               // Nepali mobile, 10 digits starting 96/97/98; identifies the buyer, cannot change later
    ?string $fullName = null,            // wire full_name
    ?string $address = null,
    array $extra = [],
)

new CustomerUpdateParams(
    ?string $fullName = null,            // wire full_name; every field optional, only what you set is sent
    ?string $email = null,
    ?string $address = null,
    ?string $phone = null,               // accepted only at its current value
    array $extra = [],
)

new CreateCheckoutSessionParams(
    array $items,                        // list<CheckoutItem>, one to ten
    string $returnUrl,                   // wire return_url; required
    ?string $customerId = null,          // omitted when null; omitting lets the buyer identify by OTP at checkout
    array $extra = [],
)

// Two named constructors — no public constructor — making the API's mutually
// exclusive item shapes unrepresentable rather than a 400 at runtime.
CheckoutItem::billingPeriod(string $pbpId, array $extra = []): self
CheckoutItem::inline(
    string $name,
    string $amount,                      // decimal string, never a float
    IntervalType|string $intervalType,
    int $intervalCount,                  // 1-1095 day, 1-156 week, 1-36 month, 1-3 year, 0 (required) for one_time
    ?string $discountAmount = null,      // decimal string, omitted when null
    array $extra = [],
): self

new WebhookParams(
    WebhookEvent|string $event,          // required; a case or a raw wire string for an unnamed event
    string $endpointUrl,                 // wire endpoint_url; required; https, public addresses only
    ?bool $isActive = null,              // wire is_active, omitted when null
    array $extra = [],
)

new WebhookUpdateParams(
    WebhookEvent|string|null $event = null,
    ?string $endpointUrl = null,
    ?bool $isActive = null,
    array $extra = [],
)

// Two named constructors — no public constructor — same mutual-exclusion
// rule as CheckoutItem: either a pbp_id, or all four inline fields.
PlanChangeParams::billingPeriod(string $pbpId, array $extra = []): self
PlanChangeParams::inline(
    string $name,
    string $amount,                      // decimal string, minimum 50
    IntervalType|string $intervalType,   // one_time is refused
    int $intervalCount,
    array $extra = [],
): self

new BankAccountParams(
    string $bankName,
    string $accountName,
    string $accountNumber,               // wire account_number, 7-21 characters
    string $branch,
    array $extra = [],
)

new BankAccountUpdateParams(
    int $code,                           // required on every call — the OTP from sendOtp(); int drops a leading zero, see bank-accounts.md
    ?string $bankName = null,            // optional; only what you set is sent
    ?string $accountName = null,
    ?string $accountNumber = null,
    ?string $branch = null,
    array $extra = [],
)

new ByopCredentialsParams(
    array $fields,                       // the gateway's own wire keys, sent verbatim; no extra
)

new ByopFeeParams(
    ?string $processingFee,              // decimal string 0-100, two decimals; null clears it, always sent
    array $extra = [],
)
```

`CustomerInput`, `CustomerBilling` and `CustomerShipping` also have
`static fromWire(array $wire): self`, because the API returns the same schema on
a 201. `CreateSubscriptionParams`, `UpdateBillingCycleParams`,
`CustomerCreateParams`, `CustomerUpdateParams`, `CreateCheckoutSessionParams`,
`CheckoutItem`, `WebhookParams`, `WebhookUpdateParams`, `PlanChangeParams`,
`BankAccountParams`, `BankAccountUpdateParams`, `ByopCredentialsParams` and
`ByopFeeParams` do not.

`CustomerCreateParams` and `CustomerUpdateParams` are **not** the same type as
`CustomerInput`/`CustomerBilling`/`CustomerShipping` above — those are the
nested shape embedded in a subscription create; these are the standalone
Customers resource. `CustomerUpdateParams` distinguishes `null` (leave the
field alone) from `''` (clear it) — see `customers.md`.

## Response types — `Suqo\Model\*`

Every model has a private constructor plus `static fromWire(array $wire): self`,
and inherits `toArray(): array` — the decoded payload with wire names intact.
Never construct a model directly; read the one a method returned.

```php
Page                   int $count, ?string $next, ?string $previous, array $results
                       static fromWire(array $wire, callable $factory): self   // public constructor
SubscriptionPage       extends Page: ?int $totalSubscriptions, $activeSubscriptions,
                       $dueSubscriptions, $inactiveSubscriptions
                       static fromSubscriptionsWire(array $wire): self
MessageResponse        string $message
CheckoutSession        ?string $publicId, $expiresAt, $checkoutUrl
                       // the 201 of checkoutSessions->create() and subscriptions->renew()
CheckoutSessionDetail  ?string $publicId, $customerId, $returnUrl, $expiresAt, $completedAt;
                       ?bool $isExpired; array $lineItems (untyped, kept exactly as received);
                       ?CheckoutSeller $sellerDetails
CheckoutSeller         ?string $id, $phone, $businessLogo, $businessName
WebhookEndpoint        ?string $id, $endpointUrl, $createdAt; WebhookEvent|string|null $event;
                       ?bool $isActive
SigningSecret          string $signingSecret   // non-null; feed straight to Webhook::verify()
DetailResponse         string $detail          // non-null; testDelivery()'s 202 body
PlanChangeQuote        ?string $type, $basis, $currentDailyRate, $newDailyRate, $newExpiryDate,
                       $checkoutSessionId, $checkoutUrl; ?int $remainingDays, $amountDue, $daysAdded
                       // checkoutSessionId/checkoutUrl set only by change() on an upgrade
Payout                 ?string $payoutId, $status, $amount, $providerCharge, $suqoPlatformFee,
                       $smsCharge, $netAmount, $requestedDate, $paidDate, $receiptUrl
BankAccount            ?int $id; ?string $bankName, $accountName, $branch, $accountNumberMasked,
                       $verifiedAt, $createdAt, $updatedAt
PaymentMethod          ?string $companyId, $paymentTypeId, $paymentType, $alias, $logo, $fee;
                       ?int $order; ?bool $isActive, $isConfigured, $isVerified
ByopFee                ?string $processingFee
```

Record property lists, including `Customer`, are in `models.md`.

## Enums

```php
enum Suqo\Environment: string { Live = 'live'; Sandbox = 'sandbox'; }
    public function baseUrl(): string                 // https://be.suqo.ai | https://test-be.suqo.ai

enum Suqo\LogLevel: string { Debug; Info; Warn; Error; Off; }
    public function severity(): int                   // 10 20 30 40 100
    public function emits(self $level): bool

enum Suqo\Model\SubscriptionStatus: string {
    PendingCheckout = 'pending_checkout'; Active = 'active'; Due = 'due';
    Cancelled = 'cancelled'; PendingCancellation = 'pending_cancellation';
    Inactive = 'inactive';
}
    public static function parse(mixed $value): self|string|null

enum Suqo\IntervalType: string { Day = 'day'; Week = 'week'; Month = 'month'; Year = 'year'; OneTime = 'one_time'; }
    public static function parse(mixed $value): self|string|null

enum Suqo\Model\WebhookEvent: string {
    CheckoutSucceeded = 'checkout.succeeded'; CheckoutFailed = 'checkout.failed';
    SubscriptionStatusChanged = 'subscription.status_changed';
    ApiKeyCreated = 'api_key.created'; ApiKeyDeleted = 'api_key.deleted';
    ApiKeyExpiringSoon = 'api_key.expiring_soon'; ApiKeyExpired = 'api_key.expired';
}
    public static function parse(mixed $value): self|string|null
```

`Subscription::$status` is typed `SubscriptionStatus|string|null`,
`WebhookEndpoint::$event` is `WebhookEvent|string|null` — a case when
recognised, the raw string when not, `null` when absent, for both. Same for
`BillingPeriod::$intervalType`, except that one **stays a plain `?string`** —
retyping a published property would be breaking — so pass it through
`IntervalType::parse()` yourself if you want a case: `IntervalType` exists for
the write side (`CheckoutItem::inline()`) and for callers who would rather
compare a case than a literal.

## Cancellation

```php
Suqo\Cancellation::none(): self     // a fresh, never-cancelled token
$token->cancel(): void              // one-way latch, idempotent
$token->isCancelled(): bool
```

Pass `cancellation:` to any request method. Honoured before an attempt,
mid-flight, during retry backoff, and at each page boundary. Raises
`CancelledError`, which is never retried.

## Exceptions — `Suqo\Exception\*`

```
\RuntimeException
└── SuqoError                 status, requestId, rawBody, fieldErrors, retryAfter
    ├── AuthenticationError   401
    ├── KycRequiredError      403 + KYC-shaped body; adds ?string $kycStatus (wire status_code)
    ├── PermissionDeniedError 403, not KYC-shaped — plain "not authorized for this endpoint"
    ├── ValidationError       400; the only type that fills fieldErrors
    ├── NotFoundError         404
    ├── RateLimitError        429; check retryAfter
    ├── ServerError           >= 500
    ├── NetworkError          transport failure or timeout, status 0
    ├── CancelledError        caller cancelled, status 0, never retried
    └── NotImplementedError   declared for a resource added ahead of its operations;
                              raised by nothing today — Customers, the resource it
                              was introduced for, is fully implemented

\InvalidArgumentException
└── SuqoConfigError           bad config at construction — NOT a SuqoError
```

A 403 is checked KYC-shape first: `KycRequiredError` only when the body has
*both* a KYC `status_code` and message in that shape; any other 403 is
`PermissionDeniedError`.

`ErrorMapper::map(int $status, mixed $body, string $requestId, ?float $retryAfter = null): SuqoError`
is public for a custom transport; it returns the error rather than throwing.

## Advanced / extension points

Only reach for these when the task genuinely needs them.

```php
Suqo\Config::resolve(...same six args as the client...): self     // private constructor
Suqo\Http\HttpClientInterface::send(HttpRequest): HttpResponse    // the whole interface
Suqo\Http\CurlHttpClient::__construct(array $curlOptions = [])
Suqo\Http\Psr18HttpClient::__construct(ClientInterface, RequestFactoryInterface, StreamFactoryInterface)
Suqo\Http\HttpResponse::__construct(int $status, array $headers, string $body)
Suqo\Http\HttpResponse::header(string $name): ?string
Suqo\Http\Transport::request(string $method, string $path, ?array $body = null, array $query = [], ?Cancellation = null): TransportResponse
Suqo\Http\Transport::url(string $path, array $query = []): string
Suqo\Http\Transport::getAbsolute(string $url, ?Cancellation = null): TransportResponse
Suqo\Http\TransportResponse::object(): array
Suqo\Http\RetryPolicy::execute(string $method, Cancellation, callable $attempt): mixed
Suqo\Http\RetryPolicy::isEligible(string $method, SuqoError): bool
Suqo\Http\RetryPolicy::computeDelayMs(int $attempt, SuqoError): int
Suqo\Http\UrlBuilder::build(string $path, array $query = []): string
Suqo\Pagination::autoPage(Transport, string $firstUrl, callable $factory, ?Cancellation = null): Generator
Suqo\Endpoints::PRODUCTS | ::CUSTOMERS | ::SUBSCRIPTIONS | ::SUBSCRIPTION_BILLING_CYCLE
    | ::SUBSCRIPTION_RENEW | ::CHECKOUT_SESSIONS | ::WEBHOOKS | ::WEBHOOK_SECRET
    | ::PAYOUTS | ::BANK_ACCOUNTS | ::BYOP_PAYMENT_METHODS
Suqo\Endpoints::customerRead|subscriptionRead|subscriptionCancel|subscriptionResume
    |subscriptionChangePreview|subscriptionChange
    |checkoutSessionRead|webhookRead|webhookTestDelivery
    |payoutRead|byopCredentials|byopFees(string $id): string
Suqo\Endpoints::bankAccountRead|bankAccountSendOtp(int $id): string
Suqo\Constants::writesRetryable(): bool
Suqo\Logging\Logger::debug|info|warn|error(string $event, array $context = []): void
```

`Suqo\Model\Wire` (`nstr`, `str`, `decimal`, `nint`, `int`, `count`, `nbool`,
`nflexbool`, `object`, `objectList`, `arr`) is marked `@internal` — usable when
writing a model, but carries no stability guarantee. `nflexbool` accepts a
boolean under either JSON spelling (`true`/`false` or a string); `arr` keeps a
container exactly as it arrived, for a field openapi declares without
describing its members (`CheckoutSessionDetail::$lineItems`).

There is **no** logger injection point and **no** header hook. Set `logLevel`;
wrap `HttpClientInterface` if you need to see or alter requests.
