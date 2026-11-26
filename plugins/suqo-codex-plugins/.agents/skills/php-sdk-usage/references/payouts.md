# Payouts

`$suqo->payouts` — four operations: `list`, `autoPaging`, `create`, `read`.
Signatures in `api-surface.md`.

A payout moves every transaction currently due to your verified bank account,
less gateway fees, the platform fee and unbilled SMS usage. The bank account
itself is managed through `bankAccounts` — see `bank-accounts.md`.

## The record

`Suqo\Model\Payout` — `payoutId`, `status`, `amount`, `providerCharge`,
`suqoPlatformFee`, `smsCharge`, `netAmount`, `requestedDate`, `paidDate`,
`receiptUrl` (all `?string`), plus `toArray()`.

`payoutId` is a public id (`PYT-MF4G9W-CTEP55`). `status` is `PENDING` until
SUQO has paid the payout out, then `COMPLETED`; it stays a plain string so a
status added server-side needs no SDK release.

Every amount is a decimal string, never a float, with two decimals
(`"11835.00"`): `netAmount` is `amount` less `providerCharge`,
`suqoPlatformFee` and `smsCharge`. `paidDate` and `receiptUrl` are `null` until
the payout is paid.

## Listing

```php
foreach ($suqo->payouts->autoPaging() as $payout) {
    echo $payout->payoutId, ' ', $payout->status, ' ', $payout->netAmount, PHP_EOL;
}
```

`list()`/`autoPaging()` take the same `page`/`pageSize`/`cancellation`
parameters as every other paginated resource — see `products.md`. Newest
first, 20 per page by default and 100 at most.

## Requesting a payout

```php
use Suqo\Exception\ValidationError;

try {
    $payout = $suqo->payouts->create();
    echo $payout->payoutId, ' ', $payout->netAmount, PHP_EOL;
} catch (ValidationError $e) {
    echo $e->fieldErrors['code'][0] ?? $e->getMessage(), PHP_EOL;
}
```

Takes no parameters — no body is sent, so none needs building. Requests a
payout of **everything** currently due.

Only one payout may be pending at a time, so a repeat after a success answers
`400` rather than paying twice. `$e->fieldErrors['code'][0]` names the reason:

| `code` | Meaning |
| --- | --- |
| `pending_payout_request_exists` | A payout is already pending. |
| `bank_account_not_found` | No bank account on file — see `bank-accounts.md`. |
| `bank_account_not_verified` | The account has not been verified with its OTP. |
| `no_transactions_due` | Nothing to pay out. |
| `payout_below_minimum` | The net amount is under the minimum payout. |

`create()` is a write and is **not retried** — a `NetworkError` here means the
request may or may not have landed; check `list()`/`read()` before assuming it
failed and retrying.

## Reading one

```php
$payout = $suqo->payouts->read('PYT-MF4G9W-CTEP55');

echo $payout->status, ' ', $payout->receiptUrl ?? '(no receipt yet)', PHP_EOL;
```

To track whether a specific payout is still `PENDING` or has become
`COMPLETED`. Throws `NotFoundError` on 404.
