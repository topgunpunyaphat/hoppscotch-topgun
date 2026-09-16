import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TeamSecretAuditAction } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

type AuditEntry = {
  teamID: string;
  environmentID: string;
  environmentName: string;
  action: TeamSecretAuditAction;
  secretKeys: string[];
  actorUid?: string | null;
  actorEmail?: string | null;
};

@Injectable()
export class TeamSecretAuditService {
  private readonly logger = new Logger(TeamSecretAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private isReadAuditEnabled() {
    return (
      this.configService.get<string>('INFRA.TEAM_SECRET_VAULT_AUDIT_READS') ===
      'true'
    );
  }

  /**
   * Append one entry. Never throws: an audit failure must not turn a working
   * environment read or write into a user-facing error, so it is logged and
   * swallowed. Writes are always recorded; reads only when read auditing is
   * switched on, since every workspace load fetches every environment.
   */
  async record(entry: AuditEntry) {
    if (entry.secretKeys.length === 0) return;
    if (
      entry.action === TeamSecretAuditAction.READ &&
      !this.isReadAuditEnabled()
    )
      return;

    try {
      await this.prisma.teamSecretAuditLog.create({
        data: {
          teamID: entry.teamID,
          environmentID: entry.environmentID,
          environmentName: entry.environmentName,
          actorUid: entry.actorUid ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          secretKeys: entry.secretKeys,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record secret audit entry (${entry.action}) for environment ${entry.environmentID}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
