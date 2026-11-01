# PropertyDek AI backend

## Database

The PostgreSQL schema is defined in `prisma/schema.prisma`. It includes the 20
MVP tables for organizations, property management, maintenance, AI conversations,
notifications, and audit history.

Set both `DATABASE_URL` (Supabase transaction pooler, port `6543`) and
`DIRECT_URL` (Supabase session pooler, port `5432`) in the backend environment.
The Express runtime connects through Prisma's PostgreSQL driver adapter using
`DATABASE_URL`; Prisma CLI migrations use `DIRECT_URL`. Replace
`[YOUR-PASSWORD]` with the database password, URL-encoding reserved characters
in the password. Create and apply a migration in a development database with:

```sh
npx prisma migrate dev --name init
```

Generate the Prisma Client with:

```sh
npx prisma generate
```

## Email and password authentication

The API provides `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/refresh`, and `POST /api/auth/logout`.
Configure `JWT_SECRET` as a private random secret of at least 32 bytes; keep it
in the backend environment and never expose it to frontend code. For local
development, generate one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Registration and login return the user profile and set a 15-minute access JWT
and a 7-day refresh token in separate HttpOnly cookies. Refresh tokens are
stored as hashes in the `auth_sessions` table. The refresh endpoint issues a
new access token; the refresh token remains valid until it expires or the
session is revoked. Authenticated API requests check the session record, so
logout revokes the session immediately. Both cookies are marked `Secure` in
production. The authenticated workspace APIs are mounted under `/api/v1` and
require the access cookie (or an access-token bearer token).

Apply the auth-session migration and regenerate Prisma Client after updating
the schema:

```sh
npx prisma migrate deploy
npx prisma generate
```

## Test fixtures

After applying migrations and generating the Prisma Client, seed a repeatable
test portfolio for the existing user
`36fcbdfa-1636-40cc-a39a-5bc21d30fa9e`:

```sh
npm run seed
```

The command creates or updates a clearly named test organization and its owner
membership, then adds sample properties, units, tenants, leases, invoices,
payments, maintenance requests, technicians, assignments, comments,
notifications, an AI conversation, and import/audit records. It does not create
another user or delete existing data. Fixture IDs and the organization slug are
stable, so rerunning the command updates the same fixture records. The test
email addresses use the reserved `.test` domain. If the database is missing the
invoice `currency` column, invoices and payments are skipped and the command
reports that limitation; apply the invoice-currency migration before rerunning
to seed those records.

Registration accepts `fullName`, `email`, and `password`, plus an optional
`phone` and `avatar` file as `multipart/form-data`. Profile photos must be JPG,
PNG, or WebP and no larger than 5 MB. The backend uploads selected photos to
Cloudinary and returns the resulting `avatarUrl` in the user profile; clients
must not supply an arbitrary avatar URL.

Authenticated account settings use `GET /api/v1/users/me` and `PATCH
/api/v1/users/me` to read or update the user's name, phone, and optional `avatar`
upload. `DELETE /api/v1/users/me/avatar` removes the current photo. Image
uploads use the same JPG, PNG, or WebP and 5 MB limits as registration.

Google sign-in uses a server-side OAuth authorization-code flow with PKCE and
the same HttpOnly session cookies as email/password sign-in. Configure
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the backend environment.
`FRONTEND_URL` defaults to `http://localhost:3000`, and
`GOOGLE_REDIRECT_URI` defaults to
`http://localhost:3000/api/auth/google/callback`. The redirect URI must also be
registered as an authorized redirect URI for the Google OAuth web client. For
production, use HTTPS for both URLs. In Google Cloud Console, configure the
OAuth consent screen and create a Web application OAuth client. Use
`FRONTEND_URL` as an authorized JavaScript origin and `GOOGLE_REDIRECT_URI` as
an authorized redirect URI. For direct backend callbacks, both
`/auth/google/callback` (legacy) and `/api/auth/google/callback` are supported.

Start sign-in at `GET /api/auth/google`; Google returns to
`GET /api/auth/google/callback`. The frontend proxy must remain configured to
forward `/api/auth/*` to the backend so the callback can set first-party
session cookies. Accounts with a matching verified email are linked to Google;
an email already linked to a different provider identity is rejected.

Property documents can also be imported from Google Drive using the file picker.
The picker requests the `drive.file` scope only when used, so users select which
files PropertyDek can access; files are copied into the current property's
private document storage and are not continuously synced. Imports support
ordinary Drive files and exportable Google Docs, Sheets, Slides, and Drawings,
up to 15 MB each. Configure the Google Picker API and Drive API in the same
Google Cloud project as the OAuth client, then set the frontend
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_API_KEY`, and
`NEXT_PUBLIC_GOOGLE_APP_ID` (the numeric Google Cloud project number). Restrict
the API key to the app's website origins and Google Picker API. The frontend
client ID must match `GOOGLE_CLIENT_ID`; configure it before building the
frontend. Files are stored as property documents and are not parsed into
spreadsheet rows or other PropertyDek records.

## Workspace onboarding and dashboard API

Apply the onboarding migration and regenerate Prisma Client after updating the
schema:

```sh
npx prisma migrate deploy
npx prisma generate
```

The onboarding API supports:

- `POST /api/v1/organizations`, `GET /api/v1/organizations/current`, and
  `PATCH /api/v1/organizations/:organizationId`. Organization creation and
  creation of its active `OWNER` membership happen in one transaction.
- `GET /api/v1/onboarding/status`, `POST /api/v1/onboarding/setup-method`,
  `POST /api/v1/onboarding/demo-data`, `POST /api/v1/onboarding/complete-step`,
  and `POST /api/v1/onboarding/complete`.
- `POST /api/v1/properties`, `GET /api/v1/properties`,
  `GET|PATCH /api/v1/properties/:propertyId`,
  `POST /api/v1/properties/:propertyId/units`,
  `POST /api/v1/properties/:propertyId/units/bulk`, and
  `GET /api/v1/properties/:propertyId/units`.
- `POST /api/v1/properties/:propertyId/documents` uploads one PDF, DOC, DOCX,
  JPG, or PNG file up to 15 MB; `GET /api/v1/properties/:propertyId` includes
  the property's documents. Signed download URLs are generated by
  `GET /api/v1/properties/:propertyId/documents/:documentId/download`, and
  `DELETE /api/v1/properties/:propertyId/documents/:documentId` removes a file
  and its record. Property documents are workspace-scoped; owners, admins, and
  property managers can upload and delete, while all workspace members can
  view and download them.
- `POST|GET /api/v1/organizations/:organizationId/invitations`,
  `DELETE /api/v1/organizations/:organizationId/invitations/:invitationId`,
  and `POST /api/v1/invitations/accept`. Only owners and admins can invite or
  cancel invites; the accepted membership role always comes from the stored
  invitation. No email delivery provider is configured, so invitation tokens
  are returned once to the authorized inviter for secure delivery.
- `POST /api/v1/imports` records a CSV import request and
  `GET /api/v1/imports/:importId` reports its status. File upload, CSV parsing,
  validation, and processing are not implemented; these jobs remain in
  `AWAITING_FILE` and do not modify portfolio data.
- `GET /api/v1/dashboard/overview` and
  `GET /api/v1/dashboard/getting-started`.

The frontend proxies `/api/auth/*` and `/api/v1/*` to `BACKEND_API_URL`. The
backend defaults to port `5000`, matching the frontend rewrite default.

## Tenant management

The authenticated tenant API is mounted under `/api/v1`:

- `GET /tenants` lists tenants in the current workspace; the optional `search`
  parameter searches names, email addresses, and phone numbers.
- `POST /tenants` creates a tenant with `fullName` and optional `email`,
  `phone`, `emergencyContact`, `emergencyPhone`, and `notes`. It may also
  include an `avatar` image file as multipart form data.
- `GET /tenants/:tenantId` retrieves the tenant profile, lease history, and
  maintenance history.
- `PATCH /tenants/:tenantId` updates one or more tenant profile fields, accepts
  a replacement `avatar` image file, or clears the photo with
  `{ "removeAvatar": true }`.
- `DELETE /tenants/:tenantId` deletes a tenant only when they have no lease
  history. Maintenance records retain their history with the tenant association
  cleared.

Tenant records are scoped to the current workspace. Owners, admins, and
property managers can create, edit, and delete tenants; all workspace members
can view them. Lease history is retained and prevents tenant deletion.
Tenant photos use Cloudinary and are returned as `avatarUrl`.

## Lease management

The authenticated lease API is mounted under `/api/v1`:

- `GET /leases` lists workspace leases; optional `status` and `unitId` query
  parameters filter the results.
- `GET /leases/options` returns workspace units available for leasing and
  existing tenants.
- `POST /leases` creates a lease for an existing `tenantId` or creates a tenant
  from a `tenant` object. Lease fields include `unitId`, `startDate`,
  `endDate`, `monthlyRent`, `securityDeposit`, `rentDueDay`, `lateFee`,
  `terms`, and `status`.
- `GET /leases/:leaseId` and `PATCH /leases/:leaseId` read and update a lease.
  Status transitions are Draft → Pending/Active/Terminated, Pending →
  Active/Terminated, and Active → Ended/Terminated. Pending and active leases
  cannot overlap on a unit.
- `POST /leases/:leaseId/documents` uploads one PDF, DOC, DOCX, JPG, or PNG
  file up to 15 MB as multipart form data in the `document` field.
- `GET /leases/:leaseId/documents/:documentId/download` returns a short-lived,
  signed download URL; `DELETE /leases/:leaseId/documents/:documentId` removes
  the uploaded file and its record.

All lease records, units, tenants, and documents are scoped to the current
workspace. Owners, admins, and property managers can create/update leases and
manage lease files; other workspace roles can read them. Lease files are
uploaded to Cloudinary as authenticated raw assets and use the existing
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
backend settings.

The lease detail page can print/save a lease summary as PDF. This output is
only a summary of entered data, not a jurisdiction-specific legal agreement
or evidence of signature. E-signature is not enabled; configure a signing
provider before offering signature workflows.

## Invoices and manual payments

The authenticated invoice API is mounted under `/api/v1`:

- `GET /invoices` lists workspace invoices; optional `status` and `leaseId`
  query parameters filter results. Issued invoices with unpaid balances are
  marked overdue automatically after their due date.
- `GET /invoices/options` returns active workspace leases for invoice creation.
- `POST /invoices` creates a draft invoice for an active `leaseId`. Supply
  `description`, `periodStart`, `periodEnd`, `dueAt`, `subtotal`, `tax`,
  `total`, and an ISO 4217 `currency`. `total` must equal `subtotal + tax`.
  Invoice numbers are generated by the server.
- `GET /invoices/:invoiceId` and `PATCH /invoices/:invoiceId` retrieve and
  update invoice details. Only drafts are editable. A draft can be issued by
  setting status to `OPEN`; unpaid drafts and issued invoices can be voided.
- `POST /invoices/:invoiceId/payments` records a payment that has already been
  received, including partial payments. The amount cannot exceed the remaining
  balance and payment currency must match. Methods include cash, bank transfer,
  card received outside PropertyDek, cheque/check, and other.
- `POST /invoices/:invoiceId/payments/:paymentId/refund` records the external
  reversal of a successful manual payment and recalculates the invoice balance.
  The money movement itself must be completed outside PropertyDek.

Successful payment records update the invoice balance/status transactionally.
They are recorded as `MANUAL`; no checkout, payment processing, or provider
integration is configured. Owners, admins, property managers, and accountants
can create/update invoices and record payments; other roles have read access.
The invoice currency migration must be applied and the Prisma Client regenerated
before deploying this feature:

```sh
npx prisma migrate deploy
npx prisma generate
```

The frontend includes invoice listing/filtering, draft creation, issuance,
manual partial-payment recording, payment history, and a printable invoice.

## Maintenance management

The authenticated maintenance API is mounted under `/api/v1`:

- `GET /maintenance` lists requests and accepts optional `status`, `priority`,
  and `propertyId` filters. `GET /maintenance/options` returns active
  properties, their units, and active technicians for request forms.
- `POST /maintenance` creates a request for a workspace property and optional
  unit/tenant. `GET /maintenance/:requestId` retrieves the request, assignments,
  and activity; `PATCH /maintenance/:requestId` updates its details, priority,
  status, and schedule. Completing a request records its completion time.
- `POST /maintenance/:requestId/comments` adds a request update. Internal notes
  are restricted to owners, admins, and property managers.
- `POST /maintenance/:requestId/documents` uploads one PDF, DOC, DOCX, JPG, or
  PNG up to 15 MB in the `document` field. Download links are generated with
  `GET /maintenance/:requestId/documents/:documentId/download`; managers and
  maintenance staff can remove files with
  `DELETE /maintenance/:requestId/documents/:documentId`.
- `POST /maintenance/:requestId/assignments` assigns an active workspace
  technician; `DELETE /maintenance/:requestId/assignments/:assignmentId`
  removes an assignment.
- `POST /maintenance/technicians` adds a technician with optional contact
  details and specialties. Only owners, admins, and property managers can
  manage the technician roster.

All maintenance records and related property, unit, tenant, and technician IDs
are scoped to the current workspace. Owners, admins, property managers, and
maintenance staff can manage requests; other roles have read access. The
frontend includes a filtered request queue, request creation and detail pages,
status/schedule updates, comments, and technician roster and assignment tools.

## Cloudinary image uploads

Set these variables in `.env` (or your deployment's backend-only
environment). Keep the API secret on the server and never expose it to frontend
code:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

The backend exposes `uploadImage(buffer)` and `deleteImage(publicId)` from
`src/services/cloudinaryService.js`. It uploads an image buffer to the
`propertydek` Cloudinary folder and returns Cloudinary's upload result; use
`result.secure_url` to store or display the image. Registration accepts avatar
uploads as JPG, PNG, or WebP files up to 5 MB.