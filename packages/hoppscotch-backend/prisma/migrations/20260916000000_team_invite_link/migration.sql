-- CreateTable
CREATE TABLE "TeamInviteLink" (
    "id" TEXT NOT NULL,
    "teamID" TEXT NOT NULL,
    "creatorUid" TEXT NOT NULL,
    "role" "TeamAccessRole" NOT NULL,
    "expiresOn" TIMESTAMPTZ(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMPTZ(3),
    "createdOn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamInviteLink_teamID_idx" ON "TeamInviteLink"("teamID");

-- AddForeignKey
ALTER TABLE "TeamInviteLink" ADD CONSTRAINT "TeamInviteLink_teamID_fkey" FOREIGN KEY ("teamID") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
