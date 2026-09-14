-- CreateEnum
CREATE TYPE "TeamSecretAuditAction" AS ENUM ('READ', 'CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "TeamSecretAuditLog" (
    "id" TEXT NOT NULL,
    "teamID" TEXT NOT NULL,
    "environmentID" TEXT NOT NULL,
    "environmentName" TEXT NOT NULL,
    "actorUid" TEXT,
    "actorEmail" TEXT,
    "action" "TeamSecretAuditAction" NOT NULL,
    "secretKeys" TEXT[],
    "createdOn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamSecretAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamSecretAuditLog_teamID_createdOn_idx" ON "TeamSecretAuditLog"("teamID", "createdOn");

-- CreateIndex
CREATE INDEX "TeamSecretAuditLog_environmentID_createdOn_idx" ON "TeamSecretAuditLog"("environmentID", "createdOn");
