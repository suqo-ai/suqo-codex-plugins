# Bank accounts

`$suqo->bankAccounts` — six operations: `list`, `create`, `read`, `update`,
`delete`, `sendOtp`. Signatures in `api-surface.md`.

The account `payouts` are paid to — one per seller. See `payouts.md`.

## The record

`Suqo\Model\BankAccount` — `id` (`?int`), `bankName`, `accountName`, `branch`,
`accountNumberMasked`, `verifiedAt`, `createdAt`, `updatedAt` (`?string`), plus
`toArray()`.

`id` is an **integer** — unlike the prefixed public ids elsewhere in the API
(`cus_…`, `cks_…`, `whk_…`, `PYT-…`). Every method on this resource that takes
an id therefore takes `int`, not `string`.

`accountNumberMasked` carries the full number while the account is
unverified, so it can be checked before verifying, and is masked
(`****4521`) once `verifiedAt` is set. The account number itself is never
returned under its own name once masking applies.

## Verification flow

An account starts **unverified**. `sendOtp()` emails a 6-digit code — to the
seller's verified company or login email, **not to the caller** — and
`update()` with that code verifies it. A payout needs a verified account.

```php
use Suqo\Params\BankAccountParams;
use Suqo\Params\BankAccountUpdateParams;

$account = $suqo->bankAccounts->create(new BankAccountParams(
    bankName: 'Nabil Bank',
    accountName: 'Himalayan Tea Pvt. Ltd.',
    accountNumber: '0010012345214521',
    branch: 'Kathmandu',
));

$suqo->bankAccounts->sendOtp($account->id);
// …the seller reads the emailed code…
$verified = $suqo->bankAccounts->update($account->id, new BankAccountUpdateParams(code: (int) $codeTheSellerTyped));
```

`create()`'s four fields are all required: `bankName`, `accountName`,
`accountNumber` (7–21 characters), `branch`. Throws `ValidationError` on 400 —
invalid fields, or `code: bank_account_limit_reached` when the account already
has one (one per seller).

`sendOtp()` takes no body; sending again replaces the previous code.

`update()`'s `code` is required on **every** call — it is what verifies the
account, and every edit needs a fresh code. `bankName`, `accountName`,
`accountNumber`, `branch` are optional and only what you set is sent, so
verifying without changing anything is
`new BankAccountUpdateParams(code: (int) $codeTheSellerTyped)`. Throws `ValidationError` on a
wrong or expired code (`fieldErrors['code']`, and nothing is changed),
invalid fields, or `code: bank_account_has_active_payout` while a payout to
this account is pending; `RateLimitError` on 429 — code attempts are
throttled.

**Never hard-code the code as a PHP literal, and never let it lose a leading
zero.** `BankAccountUpdateParams` types `code` as `int` (SDK 1.2.0), so a code
the email shows as `012345` reaches the API as `12345` and is refused as wrong.
Worse, the literal `012345` is **octal** in PHP (`5349`). Pass the code the
seller typed, and if it starts with `0` tell them the SDK cannot send it yet.
Ask for a new code with `sendOtp()`. The API itself accepts the code as a
string; the SDK's `int` is a known bug.

**A wrong code and a refusal land in the same place.** The SDK files every key
of a 400 body under `fieldErrors`, so both end up in `fieldErrors['code'][0]`:

| 400 body | `fieldErrors` | Meaning |
| --- | --- | --- |
| `{"code": "Invalid verification code."}` | `['code' => ['Invalid verification code.']]`, no `detail` | Wrong, expired or missing OTP. Nothing changed; send a new code. |
| `{"detail": "…", "code": "bank_account_has_active_payout"}` | `['detail' => […], 'code' => ['bank_account_has_active_payout']]` | A refusal: `code` is the reason. |

Tell them apart by `detail`: only a refusal has it.

```php
} catch (ValidationError $e) {
    if (isset($e->fieldErrors['detail'])) {
        $reason = $e->fieldErrors['code'][0] ?? null;    // e.g. bank_account_has_active_payout
    } elseif (isset($e->fieldErrors['code'])) {
        $otpProblem = $e->fieldErrors['code'][0];        // "Invalid verification code."
    }
}
```

## Listing

```php
foreach ($suqo->bankAccounts->list() as $account) {
    echo $account->id, ' ', $account->bankName, ' ', $account->accountNumberMasked, PHP_EOL;
}
```

**Not paginated** — a bare JSON array, `[]` when there are none. No `Page` and
nothing to `autoPaging()` over.

## Reading one

```php
$account = $suqo->bankAccounts->read($account->id);
```

Throws `NotFoundError` on 404.

## Deleting

```php
$suqo->bankAccounts->delete($account->id);
```

Answers 204 with no body. Throws `ValidationError` with
`code: bank_account_has_active_payout` while a payout to it is pending —
delete after the payout settles, not instead of waiting for it.
