# Customers

`$suqo->customers` — five operations: `list`, `autoPaging`, `read`, `create`,
`update`. Signatures in `api-surface.md`.

A customer record is also created implicitly the first time someone
subscribes, through `subscriptions->create()`'s `customer` field; `create()`
records one without opening a subscription.

## The record

`Suqo\Model\Customer` — `id`, `buyerPhone`, `buyerEmail`, `fullName`,
`address`, `createdAt` (all `?string`), plus `toArray()`.

`id` is a **prefixed public id** (`cus_0390b1820`) — not an integer, and not a
UUID like the subscription ids elsewhere in the API.

Every field except `id`, `buyerPhone` and `createdAt` can be `null` in
practice; a record with only a phone number on file is normal.

`buyerPhone` and `buyerEmail` keep their wire stems — the `client` →
`customer` rename covers only the field named `client`. This record is a
different shape from the `customer` embedded on a subscription
(`SubscriptionCustomer`, which has `phone`/`fullName`/`email` with no prefix
plus nested `billing`/`shipping`). They both describe a buyer; they are not
the same type, and the SDK never conflates them.

## Listing

```php
$page = $suqo->customers->list(pageSize: 50);

foreach ($page->results as $customer) {
    echo $customer->id, ' ', $customer->buyerPhone, PHP_EOL;
    echo '  ', $customer->fullName ?? '(no name)', PHP_EOL;
    echo '  ', $customer->address ?? '(no address)', PHP_EOL;
}
```

```php
foreach ($suqo->customers->autoPaging(cancellation: $token) as $customer) {
    handle($customer);
}
```

Same pagination shape as `products->list()`/`->autoPaging()` — see
`products.md`.

## Reading one

```php
$customer = $suqo->customers->read('cus_0390b1820');

echo $customer->buyerEmail ?? '-', PHP_EOL;
```

Throws `NotFoundError` on 404 — including for an id belonging to another
environment, which looks identical.

The operation is named `read`, not `retrieve` or `get`.

## Creating

```php
use Suqo\Params\CustomerCreateParams;

$customer = $suqo->customers->create(new CustomerCreateParams(
    email: 'ram@example.com',
    phone: '9810000001',
    fullName: 'Ram Bahadur',
    address: 'Kathmandu, Nepal',
));

echo $customer->id, PHP_EOL;   // cus_2a108b4eb
```

Records a customer on your account without opening a subscription. `email` is
the only required field.

**The call is an upsert, and that is what makes it safe to retry.** An email or
phone your account already holds corrects that customer and answers **200**
instead of **201**. The SDK decodes both into the same `Customer`; nothing in
the return value distinguishes them — compare `id` or `createdAt` if you need
to know which happened.

`phone`, when sent, must be a Nepali mobile number — ten digits starting 96, 97
or 98. A `+977` country code, a leading zero, spaces and dashes are accepted
and stripped server-side. It identifies the buyer and cannot be changed
afterwards.

The name and address are **your account's own copy** of the buyer's details,
not a shared profile — not visible to other sellers.

What you send and what you read back are spelled differently: `phone` and
`email` go out under those names and come back as `buyerPhone` and
`buyerEmail`.

Throws `ValidationError` on 400 (a missing email, a rejected phone, or
`{"email": ["You cannot add yourself as a customer."]}`), `AuthenticationError`
on 401, `KycRequiredError` / `PermissionDeniedError` on 403.

## Updating

```php
use Suqo\Params\CustomerUpdateParams;

// Rename, leave everything else alone.
$suqo->customers->update('cus_2a108b4eb', new CustomerUpdateParams(
    fullName: 'Ram Bahadur',
));

// Clear the address.
$suqo->customers->update('cus_2a108b4eb', new CustomerUpdateParams(address: ''));
```

Every field is optional and only what you set is sent — a true PATCH.

**`null` and `''` are different instructions.** Leaving a field `null` omits it
from the body; passing `''` sends it and clears it.

The phone identifies the buyer and cannot be changed — the API accepts it only
at its current value and answers `{"phone": ["Phone cannot be changed."]}`
otherwise. `CustomerUpdateParams` still takes a `phone` parameter so that a
round trip through `toArray()` can resend it unchanged; leave it `null` in
ordinary use.

Throws `NotFoundError` on 404, `ValidationError` on 400.

## What this is not

There is no `delete`, no `merge`, and no server-side search by phone or email
— paginate and filter client-side, or key your own records on `id`.
