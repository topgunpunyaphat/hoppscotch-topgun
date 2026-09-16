import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import * as E from 'fp-ts/Either';

import { GqlAuthGuard } from 'src/guards/gql-auth.guard';
import { GqlThrottlerGuard } from 'src/guards/gql-throttler.guard';
import { GqlUser } from 'src/decorators/gql-user.decorator';
import { AuthUser } from 'src/types/AuthUser';
import { RequiresTeamRole } from 'src/team/decorators/requires-team-role.decorator';
import { GqlTeamMemberGuard } from 'src/team/guards/gql-team-member.guard';
import { TeamAccessRole, TeamMember } from 'src/team/team.model';
import { throwErr } from 'src/utils';

import { TeamInviteLink } from './team-invite-link.model';
import { TeamInviteLinkInfo } from './team-invite-link-info.model';
import { TeamInviteLinkService } from './team-invite-link.service';
import { TeamInviteLinkOwnerGuard } from './team-invite-link-owner.guard';

@UseGuards(GqlThrottlerGuard)
@Resolver(() => TeamInviteLink)
export class TeamInviteLinkResolver {
  constructor(private readonly service: TeamInviteLinkService) {}

  @Query(() => [TeamInviteLink], {
    description: 'Lists the join links for a team',
  })
  @UseGuards(GqlAuthGuard, GqlTeamMemberGuard)
  @RequiresTeamRole(TeamAccessRole.OWNER)
  teamInviteLinks(
    @Args({ name: 'teamID', type: () => ID }) teamID: string,
  ): Promise<TeamInviteLink[]> {
    return this.service.getInviteLinks(teamID);
  }

  @Query(() => TeamInviteLinkInfo, {
    description:
      'What a join link points at, so the joiner can see the team before committing',
  })
  // Any signed-in user, by design: whoever holds the link is the audience.
  @UseGuards(GqlAuthGuard)
  async teamInviteLinkInfo(
    @Args({ name: 'linkID', type: () => ID }) linkID: string,
  ): Promise<TeamInviteLinkInfo> {
    const info = await this.service.getInviteLinkInfo(linkID);
    if (E.isLeft(info)) throwErr(info.left);
    return info.right;
  }

  @Mutation(() => TeamInviteLink, {
    description: 'Creates a shareable join link for a team',
  })
  @UseGuards(GqlAuthGuard, GqlTeamMemberGuard)
  @RequiresTeamRole(TeamAccessRole.OWNER)
  async createTeamInviteLink(
    @GqlUser() user: AuthUser,
    @Args({ name: 'teamID', type: () => ID }) teamID: string,
    @Args({
      name: 'role',
      type: () => TeamAccessRole,
      description: 'Role granted to joiners. OWNER is not allowed.',
    })
    role: TeamAccessRole,
    @Args({
      name: 'expiresInHours',
      type: () => Int,
      nullable: true,
      description: 'Omit for a link that never expires',
    })
    expiresInHours?: number,
    @Args({
      name: 'maxUses',
      type: () => Int,
      nullable: true,
      description: 'Omit for a link that can be used any number of times',
    })
    maxUses?: number,
  ): Promise<TeamInviteLink> {
    const link = await this.service.createInviteLink(
      { id: teamID },
      user,
      role,
      expiresInHours,
      maxUses,
    );
    if (E.isLeft(link)) throwErr(link.left);
    return link.right;
  }

  @Mutation(() => TeamInviteLink, {
    description: 'Revokes a join link so it stops working',
  })
  @UseGuards(GqlAuthGuard, TeamInviteLinkOwnerGuard)
  async revokeTeamInviteLink(
    @Args({ name: 'linkID', type: () => ID }) linkID: string,
  ): Promise<TeamInviteLink> {
    const revoked = await this.service.revokeInviteLink(linkID);
    if (E.isLeft(revoked)) throwErr(revoked.left);
    return revoked.right;
  }

  @Mutation(() => TeamMember, {
    description: 'Joins the team a link points at',
  })
  @UseGuards(GqlAuthGuard)
  async joinTeamByInviteLink(
    @GqlUser() user: AuthUser,
    @Args({ name: 'linkID', type: () => ID }) linkID: string,
  ): Promise<TeamMember> {
    const member = await this.service.joinByInviteLink(linkID, user);
    if (E.isLeft(member)) throwErr(member.left);
    return member.right;
  }
}
