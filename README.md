# PropertyDek AI backend

## Database

The PostgreSQL schema is defined in `prisma/schema.prisma`. It includes the 20
MVP tables for organizations, property management, maintenance, AI conversations,
notifications, and audit history.

Set both `DATABASE_URL` (Supabase transaction pooler, port `6543`) and
`DIRECT_URL` (Supabase session pooler, port `5432`) in the backend environment.
Prisma CLI migrations use `DIRECT_URL`; replace `[YOUR-PASSWORD]` with the
database password, URL-encoding reserved characters in the password. Create and
apply a migration in a development database with:

```sh
npx prisma migrate dev --name init
```

Generate the Prisma Client with:

```sh
npx prisma generate
```

## Cloudinary image uploads

Set these variables in `.env` (or your deployment's backend-only
environment). Keep the API secret on the server and never expose it to frontend
code:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

The backend exposes `uploadImage(buffer)` from
`src/services/cloudinaryService.js`. It uploads an image buffer to the
`propertydek` Cloudinary folder and returns Cloudinary's upload result; use
`result.secure_url` to store or display the image. Call it from an authenticated
route, and validate upload type and size in that route before passing the file
buffer.