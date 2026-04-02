# Livcare Medical Systems Backend

Production-ready REST API backend for the Livcare storefront (`frontend/`) and admin panel (`admin/`).

## Tech

- Node.js + Express
- MongoDB + Mongoose
- JWT auth (Bearer token)
- Role-based access (`admin`, `user`)
- Validation: `express-validator`
- Security: `helmet`, `cors`, `express-rate-limit`

## Folder Structure

- `config/` (env + db)
- `controllers/`
- `models/`
- `routes/`
- `middleware/`
- `utils/`
- `scripts/` (seeders)
- `server.js`

## Frontend Analysis Summary

The current frontend is mostly mock-data driven, but its structure clearly implies these backend-backed domains:

- `Storefront catalog`
  - Product listing, detail view, search, brand/category filters, retail vs B2B products.
- `Quote / enquiry flow`
  - Public quote form for B2B products.
- `Retail checkout`
  - Cart, shipping address, checkout, order creation, invoice generation, order history, tracking.
- `Customer account`
  - Profile read/update, account deactivation, addresses, GST details, notification settings.
- `Support flows`
  - Contact, appointment booking, support tickets, installation / AMC / maintenance requests.
- `Admin panel`
  - Product management, enquiry management, reporting/metrics, global MRP visibility toggle.
- `CMS-backed informational pages`
  - Help center, FAQs, policy/help content can be served from CMS endpoints instead of hardcoded copy.

## Backend Design

### Core modules

- `auth`
  - JWT access + refresh token flow, email verification, password reset.
- `users`
  - Customer profile, settings, addresses, GST data, account lifecycle.
- `catalog`
  - Products, filters, searchable metadata, public/app settings.
- `sales`
  - Cart, checkout, orders, invoices, tracking, payments/refunds.
- `crm`
  - Enquiries, contact messages, appointments.
- `support`
  - Tickets, ticket comments, service requests.
- `cms`
  - Content pages, FAQs, help articles.
- `admin`
  - Reports, audit logs, product visibility, enquiry workflows, app settings.

### Data models

- `User`
- `RefreshToken`
- `Product`
- `Cart`
- `Order`
- `Payment`
- `Refund`
- `Enquiry`
- `Appointment`
- `ContactMessage`
- `Ticket`
- `TicketComment`
- `ServiceRequest`
- `ContentPage`
- `Faq`
- `HelpArticle`
- `NotificationTemplate`
- `NotificationLog`
- `AuditLog`
- `AppSetting`

## Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env`

Copy `.env.example` to `.env` and update values.

3. Run

```bash
npm run dev
```

Server runs on `http://localhost:5000` by default.

## Environment Variables

See `.env.example`.

Required:

- `MONGODB_URI`
- `JWT_SECRET`
- `RAZORPAY_KEY_ID` for Checkout key injection and server-side Razorpay API calls
- `RAZORPAY_KEY_SECRET` for payment signature verification and Razorpay API calls
- `RAZORPAY_WEBHOOK_SECRET` for `POST /api/payments/webhooks/razorpay`

Recommended payment env vars:

- `AUTO_REFUND_ENABLED=true|false`
- `RAZORPAY_CAPTURE_MODE=auto|manual`
- `PAYMENT_RECONCILE_WORKER_ENABLED=true|false`
- `PAYMENT_RECONCILE_INTERVAL_MS`
- `PAYMENT_RECONCILE_CUTOFF_MINUTES`
- `PAYMENT_RECONCILE_BATCH_SIZE`
- `REFUND_RETRY_WORKER_ENABLED=true|false`
- `REFUND_RETRY_INTERVAL_MS`
- `REFUND_RETRY_DELAY_MINUTES`
- `REFUND_RETRY_BATCH_SIZE`
- `REFUND_RETRY_MAX_ATTEMPTS`

## Security

- **JWT Auth**
  - Access token via `Authorization: Bearer <token>`
  - Refresh token rotation supported via `/api/auth/refresh`
- **RBAC**
  - `requireRole('admin')` protects admin endpoints
- **Rate limiting**
  - Global limiter via `express-rate-limit` (configurable in env)
- **Input validation**
  - `express-validator` + centralized `validate` middleware
- **Audit logs**
  - Admin-accessible via `GET /api/admin/audit-logs`
  - Currently instrumented for key admin actions (products, enquiries, orders)
- **CORS protection**
  - Dev can be permissive
  - Production expects explicit allowlist via `CORS_ORIGINS` (comma-separated)

## Response Format

Success:

```json
{
  "success": true,
  "message": "...",
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "message": "...",
  "error": "ErrorName",
  "details": []
}
```

## API Endpoints

Base URL: `/api`

### Health

- `GET /api/health`

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `GET /api/auth/me` (requires auth)

### Users (admin)

- `GET /api/users` (admin)
- `PATCH /api/users/:id/role` (admin)

### User Profile & Account (authenticated)

- `GET /api/users/me`
- `PATCH /api/users/me`
- `PATCH /api/users/me/settings`
- `PATCH /api/users/me/gst`
- `GET /api/users/me/addresses`
- `POST /api/users/me/addresses`
- `PATCH /api/users/me/addresses/:addressId`
- `DELETE /api/users/me/addresses/:addressId`
- `DELETE /api/users/me` (soft delete / deactivate)

### Products

- `GET /api/products`
- `GET /api/products/meta`
- `GET /api/products/:id`
- `POST /api/products` (admin)
- `PATCH /api/products/:id` (admin)
- `DELETE /api/products/:id` (admin)

### App Settings

- `GET /api/settings`
- `GET /api/settings/admin` (admin)
- `GET /api/settings/admin/history` (admin)
- `PUT /api/settings` (admin)

### Enquiries / Quote Requests

- `POST /api/enquiries` (public)
- `GET /api/enquiries` (admin)
- `PATCH /api/enquiries/:id/status` (admin)
- `PATCH /api/enquiries/:id/assign` (admin)
- `POST /api/enquiries/:id/first-response` (admin)

### Appointments

- `POST /api/appointments` (public)
- `GET /api/appointments` (admin)
- `PATCH /api/appointments/:id/status` (admin)

### Contact

- `POST /api/contact` (public)
- `GET /api/contact` (admin)

### Cart (authenticated)

- `GET /api/cart`
- `POST /api/cart/items`
- `PATCH /api/cart/items/:productId`
- `DELETE /api/cart/items/:productId`
- `DELETE /api/cart` (clear cart)

### Checkout & Orders (authenticated)

- `POST /api/orders/checkout`
- `GET /api/orders`
- `GET /api/orders/:id`
- `GET /api/orders/:id/timeline`
- `GET /api/orders/:id/invoice` (HTML)
- `GET /api/orders/:id/invoice.pdf` (PDF download)

### Order Status Updates (admin)

- `PATCH /api/orders/:id/status`

### Tracking & Shipping

- `GET /api/tracking/order/:orderNumber`
- `GET /api/tracking/tracking/:trackingId`
- `PATCH /api/tracking/orders/:id/shipment` (admin)
- `POST /api/tracking/webhooks/carrier` (stub)

### Support Tickets

- `POST /api/tickets` (authenticated)
- `GET /api/tickets/me` (authenticated)
- `GET /api/tickets/me/:id` (authenticated)
- `GET /api/tickets` (admin)
- `PATCH /api/tickets/:id/status` (admin)
- `PATCH /api/tickets/:id/assign` (admin)

### Ticket Comments

- `GET /api/tickets/comments/:ticketId` (authenticated)
- `POST /api/tickets/comments/:ticketId` (authenticated)

### Service Requests (Installation / AMC / Service Scheduling)

- `POST /api/service-requests` (authenticated)
- `GET /api/service-requests/me` (authenticated)
- `GET /api/service-requests` (admin)
- `PATCH /api/service-requests/:id` (admin)

### Payments (Razorpay)

- `POST /api/payments/razorpay/order` (authenticated)
- `POST /api/payments/razorpay/verify` (authenticated)
- `POST /api/payments/retry` (authenticated)
- `GET /api/payments/status/:orderId` (authenticated)
- `POST /api/payments/cod` (authenticated)
- `POST /api/payments/refunds` (admin)
- `POST /api/payments/refunds/retry` (admin)
- `GET /api/payments/admin/transactions` (admin)
- `POST /api/payments/webhooks/razorpay` (webhook)

## Razorpay Setup

1. Create a Razorpay account and enable the required payment methods in the Razorpay dashboard.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`.
3. Keep `RAZORPAY_CAPTURE_MODE=auto` unless you intentionally want manual capture. Manual mode is supported and will attempt capture during verification.
4. In the Razorpay dashboard, configure a webhook endpoint that points to:

`POST /api/payments/webhooks/razorpay`

5. Use the same `RAZORPAY_WEBHOOK_SECRET` value in Razorpay and in `backend/.env`.
6. Subscribe the webhook to at least:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `order.paid`
- `refund.processed`
- `refund.failed`

## Payment Flow

1. Checkout creates an `Order` with `paymentProvider=razorpay` and `paymentStatus=pending` for online payments.
2. `POST /api/payments/razorpay/order` creates or reuses a Razorpay order and stores a local `Payment` record.
3. Frontend completes Razorpay Checkout and calls `POST /api/payments/razorpay/verify`.
4. Verification checks the Razorpay signature, fetches the payment from Razorpay, and updates `Payment` + `Order` only when the provider state matches.
5. Razorpay webhook updates are applied idempotently with webhook dedupe keys so duplicate deliveries do not cause duplicate transitions.
6. If a payment fails or remains incomplete, `POST /api/payments/retry` supersedes the stale payment and creates a fresh Razorpay order.

## Reconciliation And Recovery

- A background reconciliation worker scans Razorpay payments stuck in `created`, `pending`, or `authorized` beyond `PAYMENT_RECONCILE_CUTOFF_MINUTES`.
- For each stale payment it fetches Razorpay state and syncs the DB idempotently:
  - captured/paid -> `Payment.status=captured`, `Order.paymentStatus=paid`
  - failed -> `Payment.status=failed`, `Order.paymentStatus=failed`
  - still pending/authorized -> structured log + alert for operational review
- This protects against missed webhooks, client disconnects, or partial failures after Razorpay accepted a payment.

## Refunds And Retry Behavior

- Admin refunds are triggered through `POST /api/payments/refunds`.
- Failed refunds can be retried through `POST /api/payments/refunds/retry` using a `refundId`, `orderId`, or `paymentId`.
- Auto-refunds can be enabled with `AUTO_REFUND_ENABLED=true` and are used during eligible order cancellation / return flows.
- Refund creation is idempotent for active refunds: duplicate `pending` or `processed` refunds are rejected.
- If Razorpay refund creation fails:
  - `Refund.status` is set to `failed`
  - `Refund.lastError` stores the last provider error
  - `Order.paymentStatus` stays `refund_pending`
  - `Payment.status` stays `refund_pending`
  - structured logs and alerts are emitted
- Failed refunds remain retryable:
  - manually by calling `POST /api/payments/refunds/retry` from admin flows
  - automatically by the refund retry worker controlled by `REFUND_RETRY_*` env vars

## Monitoring And Alerts

- Payment verification failures, webhook failures, refund failures, and stuck payments emit structured logs with `orderId`, `paymentId`, status, and error context.
- Every payment log entry is emitted as JSON and includes `orderId`, `paymentId`, `razorpayOrderId`, `razorpayPaymentId`, `status`, `errorMessage`, and `timestamp` when available.
- Alert-level logs are emitted for:
  - refund failures
  - webhook signature failures
  - payments stuck past reconciliation threshold
- Current alert transport is logging-based, which is safe for local/prod environments and can be forwarded by the host logging stack.

## Tests

Run backend payment tests with:

```bash
npm test
```

Current automated coverage includes:

- payment verification success/failure
- webhook success/failure
- refund idempotency
- retry payment flow
- reconciliation worker state sync
- refund retry worker + admin refund retry API

### CMS / Content

Public (published):

- `GET /api/cms/pages/:key`
- `GET /api/cms/faq`
- `GET /api/cms/help`
- `GET /api/cms/help/:slug`

Admin (draft/publish):

- `GET /api/cms/admin/pages`
- `PUT /api/cms/admin/pages/:key` (save draft)
- `POST /api/cms/admin/pages/:key/publish`
- `POST /api/cms/admin/pages/:key/unpublish`

- `GET /api/cms/admin/faq`
- `POST /api/cms/admin/faq` (create draft)
- `PATCH /api/cms/admin/faq/:id` (update draft)
- `POST /api/cms/admin/faq/:id/publish`
- `POST /api/cms/admin/faq/:id/unpublish`
- `DELETE /api/cms/admin/faq/:id`

- `GET /api/cms/admin/help`
- `POST /api/cms/admin/help` (create draft)
- `PATCH /api/cms/admin/help/:id` (update draft)
- `POST /api/cms/admin/help/:id/publish`
- `POST /api/cms/admin/help/:id/unpublish`
- `DELETE /api/cms/admin/help/:id`

### Notifications

Send/Queue:

- `POST /api/notifications/send` (authenticated)

Admin Templates:

- `GET /api/notifications/admin/templates`
- `PUT /api/notifications/admin/templates/:channel/:key` (save draft)
- `POST /api/notifications/admin/templates/:channel/:key/publish`
- `POST /api/notifications/admin/templates/:channel/:key/unpublish`
- `DELETE /api/notifications/admin/templates/:channel/:key`

Admin Logs + Retry:

- `GET /api/notifications/admin/logs`
- `POST /api/notifications/admin/retry`

### Admin & Reports (admin)

All endpoints support optional date range:

- `from` (ISO date)
- `to` (ISO date)

Endpoints:

- `GET /api/admin/reports/metrics`
- `GET /api/admin/reports/sales`
- `GET /api/admin/reports/conversion`
- `GET /api/admin/reports/products`
- `GET /api/admin/reports/enquiries`

### Audit Logs (admin)

- `GET /api/admin/audit-logs`

## Sample Requests

### Register

`POST /api/auth/register`

```json
{
  "fullName": "Test User",
  "email": "user@example.com",
  "password": "secret123",
  "mobile": "+91 9876543210"
}
```

### Login

`POST /api/auth/login`

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

Response:

```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<refresh_jwt>.<opaque>",
    "user": {
      "id": "...",
      "fullName": "Test User",
      "email": "user@example.com",
      "mobile": "+91 9876543210",
      "role": "user",
      "isEmailVerified": false
    }
  },
  "meta": null
}
```

### Create Enquiry (Quote Request)

`POST /api/enquiries`

```json
{
  "productId": "65f0c...",
  "fullName": "Purchase Team",
  "email": "purchase@hospital.com",
  "mobile": "9999999999",
  "organization": "City Hospital",
  "city": "Mumbai",
  "qty": 2,
  "requirements": "Need installation + 2yr AMC"
}
```

## Notes

- To make an **admin** user, register normally and then update role in DB (or via `PATCH /api/users/:id/role` using an existing admin).
- `PUT /api/settings` persists the admin dashboard's global settings, including the `MRP visibility` switch.
- `GET /api/products` and `GET /api/products/:id` automatically hide `mrp` from public responses when `catalog.mrpVisible=false`.
- The repo includes `npm run seed:catalog` to seed the 8 products currently represented in the frontend mocks.

## Integration Instructions

### 1. Start backend

```bash
cd backend
npm install
cp .env.example .env
npm run seed:catalog
npm run dev
```

Default API base URL: `http://localhost:5000/api`

### 2. Frontend connection

The storefront currently mixes direct absolute health checks with relative `/api/...` calls.

- `frontend/src/App.js`
  - Keep health check on `http://localhost:5000/api/health` or move to an env var.
- `frontend/src/components/Mainpage.jsx`
  - Already uses `PATCH /api/users/me` and `DELETE /api/users/me`.
- `frontend/src/components/CatalogPage.jsx`
  - Replace local `products` array with `GET /api/products`.
  - On quote submit call `POST /api/enquiries`.
  - Replace local cart popup state with `POST /api/cart/items`, `GET /api/cart`, and `POST /api/orders/checkout`.
- `frontend/src/components/TrackYourOrderPage.jsx`
  - Search against `GET /api/tracking/order/:orderNumber` or `GET /api/tracking/tracking/:trackingId`.
- `admin/src/pages/AdminDashboard.jsx`
  - Enquiry tab: `GET /api/enquiries`, `PATCH /api/enquiries/:id/status`, `PATCH /api/enquiries/:id/assign`
  - Product tab: `GET /api/products`, `PATCH /api/products/:id`
  - Metrics cards: `GET /api/admin/reports/metrics`
  - Global settings: `GET /api/settings/admin`, `PUT /api/settings`

### 3. Auth token usage

- Store `accessToken` returned by `POST /api/auth/login`.
- Send `Authorization: Bearer <token>` on authenticated/admin requests.
- Refresh with `POST /api/auth/refresh` when access tokens expire.

### 4. Suggested frontend migration order

1. Replace catalog data with `/api/products`
2. Wire public quote form to `/api/enquiries`
3. Wire auth/profile flows
4. Wire cart + checkout + order history
5. Wire admin product/enquiry dashboards
6. Replace hardcoded support/help content with CMS endpoints where needed
