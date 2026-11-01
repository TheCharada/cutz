# Products and stock

The products module provides an administrative catalog, an auditable inventory and a read-only
public catalog. It is separate from appointments and from future in-person sales.

## Administrative access

The following routes require an authenticated `OWNER` of the barbershop. Mutations also
validate the request origin, using the existing admin API conventions.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/b/[slug]/products` | List products |
| POST | `/api/admin/b/[slug]/products` | Create a product |
| GET | `/api/admin/b/[slug]/products/[id]` | Read a product |
| PATCH | `/api/admin/b/[slug]/products/[id]` | Edit a product or change its active state |
| GET | `/api/admin/b/[slug]/products/[id]/movements` | Read stock history (limit/offset) |
| POST | `/api/admin/b/[slug]/products/[id]/movements` | Register entry, exit or adjustment |
| PUT | `/api/admin/b/[slug]/products/[id]/image` | Upload/replace a photo |
| DELETE | `/api/admin/b/[slug]/products/[id]/image` | Remove a photo |

Products start with zero stock. There is no direct stock field in the product update
contract. After creating a product, register an `IN` movement for its initial quantity.

The stock endpoint accepts one of the following JSON bodies:

```json
{ "operationId": "11111111-1111-4111-8111-111111111111", "kind": "IN", "quantity": 10, "reason": "Initial stock" }
```

```json
{ "operationId": "22222222-2222-4222-8222-222222222222", "kind": "OUT", "quantity": 1, "reason": "Damaged item" }
```

```json
{ "operationId": "33333333-3333-4333-8333-333333333333", "kind": "ADJUSTMENT", "newQuantity": 8, "reason": "Physical count" }
```

The operation ID must be unique within a barbershop. Repeating an operation with the
same ID and identical data returns the recorded movement without applying it again.
Reusing the ID for different data returns HTTP 409.

Inventory changes lock the product and update its quantity together with the
immutable movement record in one database transaction. The balance cannot go
negative. Corrections should be made through new movements, rather than editing
existing movements.

## Public access

- `GET /api/b/[slug]/products` lists active products, with prices, image URLs and a
  boolean availability flag. It does not expose exact quantities.
- `GET /b/[slug]/products` shows the catalog in the browser.
- `GET /api/b/[slug]/images/products/[id]` serves active product photographs.

There is no basket, checkout, online order or payment integration. Sales and their
automatic inventory deductions can be added later, using the same movement history.

## Images and deployment

Product images reuse the existing `StorageProvider`, WebP conversion and
`cutz-media` volume mounted at `/data/media` in the web container. No additional
service, secret or Docker volume is required.

Uploads accept JPEG, PNG or WebP up to 4 MiB, are converted to WebP, and reference
a storage key in PostgreSQL. The existing media volume must be preserved during
updates; a PostgreSQL dump alone does not contain the image files.

The first PR introduces the database migration. Apply migrations before starting
the updated web container. The worker and Telegram integration need no changes.
