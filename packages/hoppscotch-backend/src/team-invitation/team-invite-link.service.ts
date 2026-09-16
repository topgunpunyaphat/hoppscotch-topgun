import { Injectable } from '@nestjs/common';
import * as E from 'fp-ts/Either';
import {
  TeamInviteLink as DBTeamInviteLink,
  Prisma,
} from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { TeamAccessRole } from 'src/team/team.model';
import { TeamService } from 'src/team/team.service';
import {
  TEAM_INVITE_ALREADY_MEMBER,
  TEAM_INVITE_LINK_INACTIVE,
  TEAM_INVITE_LINK_INVALID_LIMIT,
  TEAM_INVITE_LINK_INVALID_ROLE,
  TEAM_INVITE_LINK_NOT_FOUND,
} from 'src/errors';
import { AuthUser } from 'src/types/AuthUser';
import { TeamInviteLink } from './team-invite-link.model';

@Injectable()
export class TeamInviteLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: PubSubService,
    private readonly teamService: TeamService,
  ) {}

  /**
   * Whether the link can be used right now. Kept in one place so the resolver's
   * `active` field and the join path cannot drift apart.
   */
  private isActive(link: DBTeamInviteLink, now = new Date()) {
    if (link.revokedAt) return false;
    if (link.expiresOn && link.expiresOn <= now) return false;
    if (link.maxUses !== null && link.useCount >= link.maxUses) return false;
    return true;
  }

  private cast(link: DBTeamInviteLink): TeamInviteLink {
    return { ...link, role: TeamAccessRole[link.role], active: this.isActive(link) };
  }

  /**
   * Create a shareable join link for a team.
   *
   * OWNER is rejected: a link travels through chat, and ownership should not be
   * transferable by forwarding a URL.
   */
  async createInviteLink(
    team: { id: string },
    creator: AuthUser,
    role: TeamAccessRole,
    expiresInHours?: number | null,
    maxUses?: number | null,
  ) {
    if (role === TeamAccessRole.OWNER)
      return E.left(TEAM_INVITE_LINK_INVALID_ROLE);

    if (expiresInHours !== undefined && expiresInHours !== null && expiresInHours <= 0)
      return E.left(TEAM_INVITE_LINK_INVALID_LIMIT);

    if (maxUses !== undefined && maxUses !== null && maxUses <= 0)
      return E.left(TEAM_INVITE_LINK_INVALID_LIMIT);

    const link = await this.prisma.teamInviteLink.create({
      data: {
        teamID: team.id,
        creatorUid: creator.uid,
        role,
        maxUses: maxUses ?? null,
        expiresOn:
          expiresInHours !== undefined && expiresInHours !== null
            ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
            : null,
      },
    });

    const cast = this.cast(link);
    this.pubsub.publish(`team_invite_link/${team.id}/created`, cast);
    return E.right(cast);
  }

  async getInviteLinks(teamID: string) {
    const links = await this.prisma.teamInviteLink.findMany({
      where: { teamID },
      orderBy: { createdOn: 'desc' },
    });
    return links.map((link) => this.cast(link));
  }

  /** Details a prospective joiner may see before committing — no creator, no counts. */
  async getInviteLinkInfo(linkID: string) {
    const link = await this.prisma.teamInviteLink.findUnique({
      where: { id: linkID },
      include: { team: { select: { name: true } } },
    });
    if (!link) return E.left(TEAM_INVITE_LINK_NOT_FOUND);
    if (!this.isActive(link)) return E.left(TEAM_INVITE_LINK_INACTIVE);

    return E.right({
      id: link.id,
      teamID: link.teamID,
      teamName: link.team.name,
      role: TeamAccessRole[link.role],
    });
  }

  async revokeInviteLink(linkID: string) {
    try {
      const link = await this.prisma.teamInviteLink.update({
        where: { id: linkID },
        data: { revokedAt: new Date() },
      });
      const cast = this.cast(link);
      this.pubsub.publish(`team_invite_link/${link.teamID}/revoked`, cast);
      return E.right(cast);
    } catch {
      return E.left(TEAM_INVITE_LINK_NOT_FOUND);
    }
  }

  /**
   * Join the team a link points at.
   *
   * The use is claimed with a conditional UPDATE rather than read-then-write:
   * two people opening the last remaining use at the same moment would both
   * pass an in-process check and both get in. The `useCount` filter makes the
   * database arbitrate, and a losing update matches no row.
   */
  async joinByInviteLink(linkID: string, user: AuthUser) {
    const link = await this.prisma.teamInviteLink.findUnique({
      where: { id: linkID },
    });
    if (!link) return E.left(TEAM_INVITE_LINK_NOT_FOUND);
    if (!this.isActive(link)) return E.left(TEAM_INVITE_LINK_INACTIVE);

    const existing = await this.teamService.getTeamMember(link.teamID, user.uid);
    if (existing) return E.left(TEAM_INVITE_ALREADY_MEMBER);

    if (link.maxUses !== null) {
      const claimed = await this.prisma.teamInviteLink.updateMany({
        where: { id: linkID, revokedAt: null, useCount: { lt: link.maxUses } },
        data: { useCount: { increment: 1 } },
      });
      if (claimed.count === 0) return E.left(TEAM_INVITE_LINK_INACTIVE);
    } else {
      await this.prisma.teamInviteLink.update({
        where: { id: linkID },
        data: { useCount: { increment: 1 } },
      });
    }

    try {
      const member = await this.teamService.addMemberToTeam(
        link.teamID,
        user.uid,
        TeamAccessRole[link.role],
      );
      this.pubsub.publish(`team/${link.teamID}/member_added`, member);
      return E.right(member);
    } catch (e) {
      // Give the use back if the membership could not be created, so a failure
      // here does not silently burn a seat.
      await this.prisma.teamInviteLink
        .update({ where: { id: linkID }, data: { useCount: { decrement: 1 } } })
        .catch(() => undefined);

      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        return E.left(TEAM_INVITE_ALREADY_MEMBER);
      throw e;
    }
  }
}
