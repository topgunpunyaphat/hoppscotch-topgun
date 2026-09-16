import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from 'src/prisma/prisma.service';
import { TeamEnvironment } from './team-environments.model';
import { TeamEnvironmentsService } from './team-environments.service';
import {
  TEAM_ENVIRONMENT_NOT_FOUND,
  TEAM_ENVIRONMENT_SHORT_NAME,
  TEAM_MEMBER_NOT_FOUND,
} from 'src/errors';
import { TeamService } from 'src/team/team.service';
import { TeamAccessRole } from 'src/team/team.model';

const mockPrisma = mockDeep<PrismaService>();

const mockPubSub = {
  publish: jest.fn().mockResolvedValue(null),
};
const mockTeamService = mockDeep<TeamService>();

// `encrypt`/`decrypt` read this at call time; the vault cases below need it.
process.env.DATA_ENCRYPTION_KEY = '12345678901234567890123456789012';

// The vault is off in these tests, matching the shipped default, so secret
// values are stripped on both read and write and these cases keep asserting
// the pre-vault behaviour.
const mockConfigService = {
  get: jest.fn().mockReturnValue('false'),
};
const mockAuditService = {
  record: jest.fn().mockResolvedValue(undefined),
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const teamEnvironmentsService = new TeamEnvironmentsService(
  mockPrisma,
  mockPubSub as any,
  mockTeamService,
  mockConfigService as any,
  mockAuditService as any,
);

const teamEnvironment = {
  id: '123',
  name: 'test',
  teamID: 'abc123',
  variables: [{}],
};

beforeEach(() => {
  mockReset(mockPrisma);
  mockPubSub.publish.mockClear();
  mockConfigService.get.mockReturnValue('false');
  mockAuditService.record.mockClear();
});

describe('TeamEnvironmentsService', () => {
  describe('getTeamEnvironment', () => {
    test('should successfully return a TeamEnvironment with valid ID', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockResolvedValueOnce(
        teamEnvironment,
      );

      const result = await teamEnvironmentsService.getTeamEnvironment(
        teamEnvironment.id,
      );
      expect(result).toEqualRight(teamEnvironment);
    });

    test('should throw TEAM_ENVIRONMENT_NOT_FOUND with invalid ID', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockRejectedValueOnce(
        'RejectOnNotFound',
      );

      const result = await teamEnvironmentsService.getTeamEnvironment(
        teamEnvironment.id,
      );
      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });
  });

  describe('team secret vault', () => {
    const secretVar = {
      key: 'token',
      initialValue: 's3cr3t',
      currentValue: '',
      secret: true,
    };

    const enableVault = () =>
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'INFRA.TEAM_SECRET_VAULT_ENABLED' ? 'true' : 'false',
      );

    test('stores a secret encrypted, never as plaintext, when the vault is on', async () => {
      enableVault();
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);

      await teamEnvironmentsService.createTeamEnvironment(
        'env',
        'abc123',
        JSON.stringify([secretVar]),
      );

      const stored = (mockPrisma.teamEnvironment.create as jest.Mock).mock
        .calls[0][0].data.variables;
      expect(stored[0].initialValue).toMatch(/^vault:v1:/);
      expect(JSON.stringify(stored)).not.toContain('s3cr3t');
    });

    test('drops a secret value instead of storing it when the vault is off', async () => {
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);

      await teamEnvironmentsService.createTeamEnvironment(
        'env',
        'abc123',
        JSON.stringify([secretVar]),
      );

      const stored = (mockPrisma.teamEnvironment.create as jest.Mock).mock
        .calls[0][0].data.variables;
      expect(stored[0].initialValue).toBe('');
    });

    test('hands the plaintext back to a team member on read', async () => {
      enableVault();
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);
      await teamEnvironmentsService.createTeamEnvironment(
        'env',
        'abc123',
        JSON.stringify([secretVar]),
      );
      const stored = (mockPrisma.teamEnvironment.create as jest.Mock).mock
        .calls[0][0].data.variables;

      mockPrisma.teamEnvironment.findMany.mockResolvedValue([
        { ...teamEnvironment, variables: stored },
      ] as any);

      const [env] =
        await teamEnvironmentsService.fetchAllTeamEnvironments('abc123');
      expect(JSON.parse(env.variables)[0].initialValue).toBe('s3cr3t');
    });

    test('withholds a stored secret once the vault is switched back off', async () => {
      enableVault();
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);
      await teamEnvironmentsService.createTeamEnvironment(
        'env',
        'abc123',
        JSON.stringify([secretVar]),
      );
      const stored = (mockPrisma.teamEnvironment.create as jest.Mock).mock
        .calls[0][0].data.variables;

      mockConfigService.get.mockReturnValue('false');
      mockPrisma.teamEnvironment.findMany.mockResolvedValue([
        { ...teamEnvironment, variables: stored },
      ] as any);

      const [env] =
        await teamEnvironmentsService.fetchAllTeamEnvironments('abc123');
      expect(JSON.parse(env.variables)[0].initialValue).toBe('');
    });

    test('records the actor and secret key names — never the value — on write', async () => {
      enableVault();
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);

      await teamEnvironmentsService.createTeamEnvironment(
        'env',
        'abc123',
        JSON.stringify([secretVar]),
        { uid: 'uid-1', email: 'dev@topgun.com' },
      );

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          secretKeys: ['token'],
          actorUid: 'uid-1',
          actorEmail: 'dev@topgun.com',
        }),
      );
      expect(JSON.stringify(mockAuditService.record.mock.calls)).not.toContain(
        's3cr3t',
      );
    });
  });

  describe('createTeamEnvironment', () => {
    test('should successfully create and return a new team environment given valid inputs', async () => {
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);

      const result = await teamEnvironmentsService.createTeamEnvironment(
        teamEnvironment.name,
        teamEnvironment.teamID,
        JSON.stringify(teamEnvironment.variables),
      );

      expect(result).toEqualRight({
        ...teamEnvironment,
        variables: JSON.stringify(teamEnvironment.variables),
      });
    });

    test('should throw TEAM_ENVIRONMENT_SHORT_NAME if input TeamEnvironment name is invalid', async () => {
      const result = await teamEnvironmentsService.createTeamEnvironment(
        '',
        teamEnvironment.teamID,
        JSON.stringify(teamEnvironment.variables),
      );

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_SHORT_NAME);
    });

    test('should send pubsub message to "team_environment/<teamID>/created" if team environment is created successfully', async () => {
      mockPrisma.teamEnvironment.create.mockResolvedValue(teamEnvironment);

      await teamEnvironmentsService.createTeamEnvironment(
        teamEnvironment.name,
        teamEnvironment.teamID,
        JSON.stringify(teamEnvironment.variables),
      );

      expect(mockPubSub.publish).toHaveBeenCalledWith(
        `team_environment/${teamEnvironment.teamID}/created`,
        {
          ...teamEnvironment,
          variables: JSON.stringify(teamEnvironment.variables),
        },
      );
    });
  });

  describe('deleteTeamEnvironment', () => {
    test('should successfully delete a TeamEnvironment with a valid ID', async () => {
      mockPrisma.teamEnvironment.delete.mockResolvedValueOnce(teamEnvironment);

      const result = await teamEnvironmentsService.deleteTeamEnvironment(
        teamEnvironment.id,
      );

      expect(result).toEqualRight(true);
    });

    test('should throw TEAM_ENVIRONMMENT_NOT_FOUND if given id is invalid', async () => {
      mockPrisma.teamEnvironment.delete.mockRejectedValue('RecordNotFound');

      const result =
        await teamEnvironmentsService.deleteTeamEnvironment('invalidid');

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });

    test('should send pubsub message to "team_environment/<teamID>/deleted" if team environment is deleted successfully', async () => {
      mockPrisma.teamEnvironment.delete.mockResolvedValueOnce(teamEnvironment);

      await teamEnvironmentsService.deleteTeamEnvironment(teamEnvironment.id);

      expect(mockPubSub.publish).toHaveBeenCalledWith(
        `team_environment/${teamEnvironment.teamID}/deleted`,
        {
          ...teamEnvironment,
          variables: JSON.stringify(teamEnvironment.variables),
        },
      );
    });
  });

  describe('updateVariablesInTeamEnvironment', () => {
    test('should successfully add new variable to a team environment', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce({
        ...teamEnvironment,
        variables: [{ key: 'value' }],
      });

      const result = await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        teamEnvironment.name,
        JSON.stringify([{ key: 'value' }]),
      );

      expect(result).toEqualRight(<TeamEnvironment>{
        ...teamEnvironment,
        variables: JSON.stringify([{ key: 'value' }]),
      });
    });

    test('should successfully add new variable to already existing list of variables in a team environment', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce({
        ...teamEnvironment,
        variables: [{ key: 'value' }, { key_2: 'value_2' }],
      });

      const result = await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        teamEnvironment.name,
        JSON.stringify([{ key: 'value' }, { key_2: 'value_2' }]),
      );

      expect(result).toEqualRight(<TeamEnvironment>{
        ...teamEnvironment,
        variables: JSON.stringify([{ key: 'value' }, { key_2: 'value_2' }]),
      });
    });

    test('should successfully edit existing variables in a team environment', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce({
        ...teamEnvironment,
        variables: [{ key: '1234' }],
      });

      const result = await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        teamEnvironment.name,
        JSON.stringify([{ key: '1234' }]),
      );

      expect(result).toEqualRight(<TeamEnvironment>{
        ...teamEnvironment,
        variables: JSON.stringify([{ key: '1234' }]),
      });
    });

    test('should successfully edit name of an existing team environment', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce({
        ...teamEnvironment,
        variables: [{ key: '123' }],
      });

      const result = await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        teamEnvironment.name,
        JSON.stringify([{ key: '123' }]),
      );

      expect(result).toEqualRight(<TeamEnvironment>{
        ...teamEnvironment,
        variables: JSON.stringify([{ key: '123' }]),
      });
    });

    test('should throw TEAM_ENVIRONMENT_SHORT_NAME if input TeamEnvironment name is invalid', async () => {
      const result = await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        '',
        JSON.stringify([{ key: 'value' }]),
      );

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_SHORT_NAME);
    });

    test('should throw TEAM_ENVIRONMMENT_NOT_FOUND if provided id is invalid', async () => {
      mockPrisma.teamEnvironment.update.mockRejectedValue('RecordNotFound');

      const result = await teamEnvironmentsService.updateTeamEnvironment(
        'invalidid',
        teamEnvironment.name,
        JSON.stringify(teamEnvironment.variables),
      );

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });

    test('should send pubsub message to "team_environment/<teamID>/updated" if team environment is updated successfully', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce(teamEnvironment);

      await teamEnvironmentsService.updateTeamEnvironment(
        teamEnvironment.id,
        teamEnvironment.name,
        JSON.stringify([{ key: 'value' }]),
      );

      expect(mockPubSub.publish).toHaveBeenCalledWith(
        `team_environment/${teamEnvironment.teamID}/updated`,
        {
          ...teamEnvironment,
          variables: JSON.stringify(teamEnvironment.variables),
        },
      );
    });
  });

  describe('deleteAllVariablesFromTeamEnvironment', () => {
    test('should successfully delete all variables in a team environment', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce(teamEnvironment);

      const result =
        await teamEnvironmentsService.deleteAllVariablesFromTeamEnvironment(
          teamEnvironment.id,
        );

      expect(result).toEqualRight(<TeamEnvironment>{
        ...teamEnvironment,
        variables: JSON.stringify([{}]),
      });
    });

    test('should throw TEAM_ENVIRONMMENT_NOT_FOUND if provided id is invalid', async () => {
      mockPrisma.teamEnvironment.update.mockRejectedValue('RecordNotFound');

      const result =
        await teamEnvironmentsService.deleteAllVariablesFromTeamEnvironment(
          'invalidid',
        );

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });

    test('should send pubsub message to "team_environment/<teamID>/updated" if team environment is updated successfully', async () => {
      mockPrisma.teamEnvironment.update.mockResolvedValueOnce(teamEnvironment);

      await teamEnvironmentsService.deleteAllVariablesFromTeamEnvironment(
        teamEnvironment.id,
      );

      expect(mockPubSub.publish).toHaveBeenCalledWith(
        `team_environment/${teamEnvironment.teamID}/updated`,
        {
          ...teamEnvironment,
          variables: JSON.stringify([{}]),
        },
      );
    });
  });

  describe('createDuplicateEnvironment', () => {
    test('should successfully duplicate an existing team environment', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockResolvedValueOnce(
        teamEnvironment,
      );

      mockPrisma.teamEnvironment.create.mockResolvedValueOnce({
        id: 'newid',
        ...teamEnvironment,
      });

      const result = await teamEnvironmentsService.createDuplicateEnvironment(
        teamEnvironment.id,
      );

      expect(result).toEqualRight(<TeamEnvironment>{
        id: 'newid',
        ...teamEnvironment,
        variables: JSON.stringify(teamEnvironment.variables),
      });
    });

    test('should throw TEAM_ENVIRONMMENT_NOT_FOUND if provided id is invalid', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockRejectedValue(
        'NotFoundError',
      );

      const result = await teamEnvironmentsService.createDuplicateEnvironment(
        teamEnvironment.id,
      );

      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });

    test('should send pubsub message to "team_environment/<teamID>/created" if team environment is updated successfully', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockResolvedValueOnce(
        teamEnvironment,
      );

      mockPrisma.teamEnvironment.create.mockResolvedValueOnce({
        id: 'newid',
        ...teamEnvironment,
      });

      await teamEnvironmentsService.createDuplicateEnvironment(
        teamEnvironment.id,
      );

      expect(mockPubSub.publish).toHaveBeenCalledWith(
        `team_environment/${teamEnvironment.teamID}/created`,
        {
          id: 'newid',
          ...teamEnvironment,
          variables: JSON.stringify([{}]),
        },
      );
    });
  });

  describe('totalEnvsInTeam', () => {
    test('should resolve right and return a total team envs count ', async () => {
      mockPrisma.teamEnvironment.count.mockResolvedValueOnce(2);
      const result = await teamEnvironmentsService.totalEnvsInTeam('id1');
      expect(mockPrisma.teamEnvironment.count).toHaveBeenCalledWith({
        where: {
          teamID: 'id1',
        },
      });
      expect(result).toEqual(2);
    });
    test('should resolve left and return an error when no team envs found', async () => {
      mockPrisma.teamEnvironment.count.mockResolvedValueOnce(0);
      const result = await teamEnvironmentsService.totalEnvsInTeam('id1');
      expect(mockPrisma.teamEnvironment.count).toHaveBeenCalledWith({
        where: {
          teamID: 'id1',
        },
      });
      expect(result).toEqual(0);
    });
  });

  describe('getTeamEnvironmentForCLI', () => {
    test('should successfully return a TeamEnvironment with valid ID', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockResolvedValueOnce(
        teamEnvironment,
      );
      mockTeamService.getTeamMember.mockResolvedValue({
        membershipID: 'sdc3sfdv',
        userUid: '123454',
        role: TeamAccessRole.OWNER,
      });

      const result = await teamEnvironmentsService.getTeamEnvironmentForCLI(
        teamEnvironment.id,
        '123454',
      );
      expect(result).toEqualRight(teamEnvironment);
    });

    test('should throw TEAM_ENVIRONMENT_NOT_FOUND with invalid ID', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockRejectedValueOnce(
        'RejectOnNotFound',
      );

      const result = await teamEnvironmentsService.getTeamEnvironment(
        teamEnvironment.id,
      );
      expect(result).toEqualLeft(TEAM_ENVIRONMENT_NOT_FOUND);
    });

    test('should throw TEAM_MEMBER_NOT_FOUND if user not in same team', async () => {
      mockPrisma.teamEnvironment.findFirstOrThrow.mockResolvedValueOnce(
        teamEnvironment,
      );
      mockTeamService.getTeamMember.mockResolvedValue(null);

      const result = await teamEnvironmentsService.getTeamEnvironmentForCLI(
        teamEnvironment.id,
        '333',
      );
      expect(result).toEqualLeft(TEAM_MEMBER_NOT_FOUND);
    });
  });
});
