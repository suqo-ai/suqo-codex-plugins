# BYOP (bring your own payment)

`$suqo->byop` — three operations: `paymentMethods`, `updateCredentials`,
`updateFee`. Signatures in `api-surface.md`.

On a BYOP account a payment method collects into **your own** gateway account
rather than SUQO's. Switching an account to BYOP is done by SUQO, not through
this API; until it is, the two writes answer 403 with
`Your own payment account isn't enabled.` — if a task needs BYOP and that 403
surfaces, say the account is not on BYOP rather than retrying.

## Listing payment methods

```php
foreach ($suqo->byop->paymentMethods() as $method) {
    printf("%s  %-10s  configured=%s verified=%s\n",
        $method->paymentTypeId, $method->paymentType,
        $method->isConfigured ? 'y' : 'n',
        $method->isVerified === null ? '?' : ($method->isVerified ? 'y' : 'n'));
}
```

`Suqo\Model\PaymentMethod` — `paymentTypeId` (a UUID — the id the two writes
take), `paymentType` (e.g. `esewa`), `alias`, `logo`, `companyId` (arrives as a
number, kept as its string spelling), `order` (`?int`), `isActive` (`?bool` —
`false` for a hidden method), `fee` (`?string`, a percent decimal: your own
`processing_fee` on BYOP, `0.00` when unset; `null` for Khalti/NPS, which
report a fee per payment, and for cash), `isConfigured` (`?bool`, true once
credentials have been saved), `isVerified` (`?bool`: `true` accepted, `false`
refused, `null` not run yet).

**Not paginated** — a bare JSON array, every method on the account including
hidden ones. **Read-only**: show, hide and reorder stay on the dashboard; there
is no SDK call for them.

## Saving gateway credentials

```php
use Suqo\Params\ByopCredentialsParams;

$suqo->byop->updateCredentials($method->paymentTypeId, new ByopCredentialsParams([
    'product_code' => 'EPAYTEST',
    'merchant_secret' => getenv('ESEWA_SECRET'),
]));
```

`ByopCredentialsParams` takes the gateway's fields as an array of **wire
names**, sent verbatim — they differ per gateway (the field list is in the API
reference, not this SDK). **Send the full set every time**: it replaces what is
stored, and unknown keys are refused. Text/secret values are capped at 500
characters; a `file` field is a base64 string under 2.5 MB; a `checkbox` field
must be `true`.

**Credentials are never returned.** Each save is checked against the gateway in
the background — read `isVerified` on a later `paymentMethods()` call rather
than trusting the write itself. Replacing saved credentials emails your
company address.

Throws `ValidationError` on 400 (a field failed validation, keyed by its
dotted name — never echoing the value — or `code: byop_payment_pending` while
a payment on this gateway is still processing, or `payment_method` when the
method cannot be BYOP), `PermissionDeniedError` on 403 when the account is not
on BYOP, plus `NotFoundError`, `RateLimitError`.

## Setting the processing fee

```php
use Suqo\Params\ByopFeeParams;

echo $suqo->byop->updateFee($method->paymentTypeId, new ByopFeeParams('1.75'))->processingFee;
```

`ByopFeeParams(processingFee: '1.75')` — a decimal string, 0 to 100 with two
decimals. **`null` clears the fee and is sent explicitly** — it is not the
same as omitting the field, because there is no "leave alone" here; the
parameter is always sent.

Returns `Suqo\Model\ByopFee` — `processingFee` (`?string`), the value now
stored.

Throws `ValidationError` on 400 — out of range, or refused for Khalti and NPS,
which report their own fee on each payment rather than taking a configured
one. `PermissionDeniedError` on 403 when the account is not on BYOP.
