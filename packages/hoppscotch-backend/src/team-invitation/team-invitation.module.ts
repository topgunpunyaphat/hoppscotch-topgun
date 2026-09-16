import { Module } from '@nestjs/common';
import { TeamModule } from 'src/team/team.module';
import { UserModule } from 'src/user/user.module';
import { TeamInvitationResolver } from './team-invitation.resolver';
import { TeamInvitationService } from './team-invitation.service';
import { TeamInviteTeamOwnerGuard } from './team-invite-team-owner.guard';
import { TeamInviteViewerGuard } from './team-invite-viewer.guard';
import { TeamInviteeGuard } from './team-invitee.guard';
import { TeamTeamInviteExtResolver } from './team-teaminvite-ext.resolver';
import { TeamInviteLinkService } from './team-invite-link.service';
import { TeamInviteLinkResolver } from './team-invite-link.resolver';
import { TeamInviteLinkOwnerGuard } from './team-invite-link-owner.guard';

@Module({
  imports: [TeamModule, UserModule],
  providers: [
    TeamInvitationService,
    TeamInvitationResolver,
    TeamTeamInviteExtResolver,
    TeamInviteeGuard,
    TeamInviteViewerGuard,
    TeamInviteTeamOwnerGuard,
    TeamInviteLinkService,
    TeamInviteLinkResolver,
    TeamInviteLinkOwnerGuard,
  ],
  exports: [TeamInvitationService, TeamInviteLinkService],
})
export class TeamInvitationModule {}
