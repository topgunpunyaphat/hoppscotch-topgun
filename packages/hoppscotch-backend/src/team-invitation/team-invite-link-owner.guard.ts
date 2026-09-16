import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamService } from 'src/team/team.service';
import { TeamAccessRole } from 'src/team/team.model';
import {
  BUG_AUTH_NO_USER_CTX,
  TEAM_INVITE_LINK_NOT_FOUND,
  TEAM_NOT_REQUIRED_ROLE,
} from 'src/errors';
import { throwErr } from 'src/utils';

/**
 * Allows only an OWNER of the team a link belongs to.
 *
 * The team is resolved from the link rather than taken as an argument, so a
 * caller cannot pass a team they own alongside someone else's link.
 *
 * REQUIRES GqlAuthGuard
 */
@Injectable()
export class TeamInviteLinkOwnerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamService: TeamService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlExecCtx = GqlExecutionContext.create(context);

    const { user } = gqlExecCtx.getContext().req;
    if (!user) throwErr(BUG_AUTH_NO_USER_CTX);

    const { linkID } = gqlExecCtx.getArgs<{ linkID: string }>();
    if (!linkID) throwErr(TEAM_INVITE_LINK_NOT_FOUND);

    const link = await this.prisma.teamInviteLink.findUnique({
      where: { id: linkID },
      select: { teamID: true },
    });
    if (!link) throwErr(TEAM_INVITE_LINK_NOT_FOUND);

    const member = await this.teamService.getTeamMember(link.teamID, user.uid);
    if (!member || member.role !== TeamAccessRole.OWNER)
      throwErr(TEAM_NOT_REQUIRED_ROLE);

    return true;
  }
}
