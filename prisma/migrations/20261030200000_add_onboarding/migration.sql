CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED');
CREATE TYPE "import_status" AS ENUM ('AWAITING_FILE', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "onboarding_setup_method" AS ENUM ('FRESH', 'IMPORT', 'DEMO');

ALTER TABLE "organizations"
    ADD COLUMN "country_code" CHAR(2),
    ADD COLUMN "timezone" VARCHAR(100),
    ADD COLUMN "setup_method" "onboarding_setup_method",
    ADD COLUMN "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "team_step_completed_at" TIMESTAMPTZ(6),
    ADD COLUMN "team_step_skipped" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "demo_data_created_at" TIMESTAMPTZ(6);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "membership_role" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_id" UUID NOT NULL,
    "accepted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'AWAITING_FILE',
    "result" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_organization_id_status_created_at_idx" ON "invitations"("organization_id", "status", "created_at");
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX "import_jobs_organization_id_created_at_idx" ON "import_jobs"("organization_id", "created_at");

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "invitations_invited_by_user_id_fkey"
        FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invitations_accepted_by_user_id_fkey"
        FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_jobs"
    ADD CONSTRAINT "import_jobs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "import_jobs_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
