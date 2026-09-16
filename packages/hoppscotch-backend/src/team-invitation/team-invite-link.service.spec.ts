import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamService } from 'src/team/team.service';
import { TeamAccessRole } from 'src/team/team.model';
import {
  TEAM_INVITE_ALREADY_MEMBER,
  TEAM_INVITE_LINK_INACTIVE,
  TEAM_INVITE_LINK_INVALID_LIMIT,
  TEAM_INVITE_LINK_INVALID_ROLE,
  TEAM_INVITE_LINK_NOT_FOUND,
} from 'src/errors';
import { TeamInviteLinkService } from './team-invite-link.service';

const mockPrisma = mockDeep<PrismaService>();
const mockTeamService = mockDeep<TeamService>();
const mockPubSub = { publish: jest.fn().mockResolvedValue(null) };

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const service = new TeamInviteLinkService(
  mockPrisma,
  mockPubSub as any,
  mockTeamService,
);

const user = { uid: 'uid-1', email: 'dev@topgun.test' } as any;

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'link-1',
  teamID: 'team-1',
  creatorUid: 'owner-1',
  role: TeamAccessRole.EDITOR,
  expiresOn: null,
  maxUses: null,
  useCount: 0,
  revokedAt: null,
  createdOn: new Date(),
  ...overrides,
});

beforeEach(() => {
  mockReset(mockPrisma);
  mockReset(mockTeamService);
  mockPubSub.publish.mockClear();
});

describe('createInviteLink', () => {
  test('refuses to mint an OWNER link, which would make ownership forwardable', async () => {
    const result = await service.createInviteLink(
      { id: 'team-1' },
      user,
      TeamAccessRole.OWNER,
    );
    expect(result).toEqualLeft(TEAM_INVITE_LINK_INVALID_ROLE);
    expect(mockPrisma.teamInviteLink.create).not.toHaveBeenCalled();
  });

  test('creates an unlimited link when no limits are given', async () => {
    mockPrisma.teamInviteLink.create.mockResolvedValue(link() as any);

    const result = await service.createInviteLink(
      { id: 'team-1' },
      user,
      TeamAccessRole.EDITOR,
    );

    expect(result).toBeRight();
    const data = (mockPrisma.teamInviteLink.create as jest.Mock).mock
      .calls[0][0].data;
    expect(data).toMatchObject({ maxUses: null, expiresOn: null });
  });

  test('rejects non-positive limits', async () => {
    await expect(
      service.createInviteLink({ id: 't' }, user, TeamAccessRole.EDITOR, 0),
    ).resolves.toEqualLeft(TEAM_INVITE_LINK_INVALID_LIMIT);
    await expect(
      service.createInviteLink({ id: 't' }, user, TeamAccessRole.EDITOR, null, -1),
    ).resolves.toEqualLeft(TEAM_INVITE_LINK_INVALID_LIMIT);
  });
});

describe('joinByInviteLink', () => {
  test('reports a missing link rather than failing silently', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(null);
    await expect(service.joinByInviteLink('nope', user)).resolves.toEqualLeft(
      TEAM_INVITE_LINK_NOT_FOUND,
    );
  });

  test('refuses a revoked link', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ revokedAt: new Date() }) as any,
    );
    await expect(service.joinByInviteLink('link-1', user)).resolves.toEqualLeft(
      TEAM_INVITE_LINK_INACTIVE,
    );
  });

  test('refuses an expired link', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ expiresOn: new Date(Date.now() - 1000) }) as any,
    );
    await expect(service.joinByInviteLink('link-1', user)).resolves.toEqualLeft(
      TEAM_INVITE_LINK_INACTIVE,
    );
  });

  test('refuses a link that is out of uses', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ maxUses: 3, useCount: 3 }) as any,
    );
    await expect(service.joinByInviteLink('link-1', user)).resolves.toEqualLeft(
      TEAM_INVITE_LINK_INACTIVE,
    );
  });

  test('refuses someone who is already a member', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(link() as any);
    mockTeamService.getTeamMember.mockResolvedValue({ role: 'EDITOR' } as any);

    await expect(service.joinByInviteLink('link-1', user)).resolves.toEqualLeft(
      TEAM_INVITE_ALREADY_MEMBER,
    );
  });

  test('adds the member with the role the link carries', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ role: TeamAccessRole.VIEWER }) as any,
    );
    mockTeamService.getTeamMember.mockResolvedValue(null as any);
    mockTeamService.addMemberToTeam.mockResolvedValue({
      membershipID: 'm-1',
      role: TeamAccessRole.VIEWER,
    } as any);

    const result = await service.joinByInviteLink('link-1', user);

    expect(result).toBeRight();
    expect(mockTeamService.addMemberToTeam).toHaveBeenCalledWith(
      'team-1',
      'uid-1',
      TeamAccessRole.VIEWER,
    );
  });

  test('claims a limited use with a conditional update so two joiners cannot share the last seat', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ maxUses: 1, useCount: 0 }) as any,
    );
    mockTeamService.getTeamMember.mockResolvedValue(null as any);
    mockTeamService.addMemberToTeam.mockResolvedValue({ membershipID: 'm' } as any);
    mockPrisma.teamInviteLink.updateMany.mockResolvedValue({ count: 1 } as any);

    await service.joinByInviteLink('link-1', user);

    const where = (mockPrisma.teamInviteLink.updateMany as jest.Mock).mock
      .calls[0][0].where;
    expect(where).toMatchObject({ id: 'link-1', revokedAt: null });
    expect(where.useCount).toEqual({ lt: 1 });
  });

  test('loses the race gracefully when another joiner took the last use', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ maxUses: 1, useCount: 0 }) as any,
    );
    mockTeamService.getTeamMember.mockResolvedValue(null as any);
    mockPrisma.teamInviteLink.updateMany.mockResolvedValue({ count: 0 } as any);

    await expect(service.joinByInviteLink('link-1', user)).resolves.toEqualLeft(
      TEAM_INVITE_LINK_INACTIVE,
    );
    expect(mockTeamService.addMemberToTeam).not.toHaveBeenCalled();
  });

  test('gives the use back when the membership cannot be created', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue(
      link({ maxUses: 5, useCount: 0 }) as any,
    );
    mockTeamService.getTeamMember.mockResolvedValue(null as any);
    mockPrisma.teamInviteLink.updateMany.mockResolvedValue({ count: 1 } as any);
    mockTeamService.addMemberToTeam.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'P2002' }),
    );

    await expect(service.joinByInviteLink('link-1', user)).rejects.toThrow();

    expect(mockPrisma.teamInviteLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { useCount: { decrement: 1 } } }),
    );
  });
});

describe('getInviteLinkInfo', () => {
  test('exposes only the team name and role, never usage or creator', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue({
      ...link({ maxUses: 5, useCount: 2 }),
      team: { name: 'Topgun API Team' },
    } as any);

    const result = await service.getInviteLinkInfo('link-1');

    expect(result).toBeRight();
    if (result._tag === 'Right') {
      expect(Object.keys(result.right).sort()).toEqual([
        'id',
        'role',
        'teamID',
        'teamName',
      ]);
    }
  });

  test('hides an inactive link from a prospective joiner', async () => {
    mockPrisma.teamInviteLink.findUnique.mockResolvedValue({
      ...link({ revokedAt: new Date() }),
      team: { name: 'T' },
    } as any);

    await expect(service.getInviteLinkInfo('link-1')).resolves.toEqualLeft(
      TEAM_INVITE_LINK_INACTIVE,
    );
  });
});
