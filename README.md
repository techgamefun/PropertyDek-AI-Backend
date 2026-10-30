# PropertyDek AI backend

## Database

The PostgreSQL schema is defined in `prisma/schema.prisma`. It includes the 20
MVP tables for organizations, property management, maintenance, AI conversations,
notifications, and audit history.

Set `DATABASE_URL` in the backend environment to the PostgreSQL connection string
before running Prisma commands. Create and apply a migration in a development
database with:

```sh
npx prisma migrate dev --name init
```

Generate the Prisma Client with:

```sh
npx prisma generate
```