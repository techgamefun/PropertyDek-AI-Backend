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

Registration accepts `fullName`, `email`, and `password`, plus an optional
`phone` and `avatar` file as `multipart/form-data`. Profile photos must be JPG,
PNG, or WebP and no larger than 5 MB. The backend uploads selected photos to
Cloudinary and returns the resulting `avatarUrl` in the user profile; clients
must not supply an arbitrary avatar URL.

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