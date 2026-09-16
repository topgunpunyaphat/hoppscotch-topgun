import { Injectable } from '@nestjs/common';
import {
  TeamEnvironment as DBTeamEnvironment,
  Prisma,
} from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PubSubService } from 'src/pubsub/pubsub.service';
import { TeamEnvironment } from './team-environments.model';
import {
  TEAM_ENVIRONMENT_NOT_FOUND,
  TEAM_ENVIRONMENT_SHORT_NAME,
  TEAM_MEMBER_NOT_FOUND,
} from 'src/errors';
import * as E from 'fp-ts/Either';
import { isValidLength } from 'src/utils';
import { TeamService } from 'src/team/team.service';
import { ConfigService } from '@nestjs/config';
import { TeamSecretAuditAction } from 'src/generated/prisma/client';
import { TeamSecretAuditService } from './team-secret-audit.service';
import {
  decryptSecretVariables,
  encryptSecretVariables,
  secretKeysOf,
  stripSecretValues,
  toVariableList,
} from './vault';

/** Who performed a vault-touching operation, for the audit trail. */
export type SecretAuditActor = {
  uid?: string | null;
  email?: string | null;
};

@Injectable()
export class TeamEnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubsub: PubSubService,
    private readonly teamService: TeamService,
    private readonly configService: ConfigService,
    private readonly auditService: TeamSecretAuditService,
  ) {}

  TITLE_LENGTH = 1;

  /**
   * Whether secret values are shared through the server at all. While off,
   * secrets are blanked on both read and write, which is the pre-vault
   * behaviour and the safe default for an instance that never opted in.
   */
  private isVaultEnabled() {
    return (
      this.configService.get<string>('INFRA.TEAM_SECRET_VAULT_ENABLED') ===
      'true'
    );
  }

  /** Storage shape -> wire shape. */
  private readVariables(stored: unknown) {
    const variables = toVariableList(stored);
    return this.isVaultEnabled()
      ? decryptSecretVariables(variables)
      : stripSecretValues(variables);
  }

  /** Wire shape -> storage shape. */
  private writeVariables(incoming: unknown) {
    const variables = toVariableList(incoming);
    return this.isVaultEnabled()
      ? encryptSecretVariables(variables)
      : stripSecretValues(variables);
  }

  /**
   * TeamEnvironments are saved in the DB in the following way
   * [{ key: value }, { key: value },....]
   *
   */

  /**
   * Typecast a database TeamEnvironment to a TeamEnvironment model
   * @param teamEnvironment database TeamEnvironment
   * @returns TeamEnvironment model
   */
  private cast(teamEnvironment: DBTeamEnvironment): TeamEnvironment {
    const { id, name, teamID } = teamEnvironment;
    return {
      id,
      name,
      teamID,
      variables: JSON.stringify(this.readVariables(teamEnvironment.variables)),
    };
  }

  /**
   * Get details of a TeamEnvironment.
   *
   * @param id TeamEnvironment ID
   * @returns Either of a TeamEnvironment or error message
   */
  async getTeamEnvironment(id: string) {
    try {
      const teamEnvironment =
        await this.prisma.teamEnvironment.findFirstOrThrow({
          where: { id },
        });
      return E.right(teamEnvironment);
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }

  /**
   *  Create a new TeamEnvironment.
   *
   * @param name name of new TeamEnvironment
   * @param teamID teamID of new TeamEnvironment
   * @param variables JSONified string of contents of new TeamEnvironment
   * @returns Either of a TeamEnvironment or error message
   */
  async createTeamEnvironment(
    name: string,
    teamID: string,
    variables: string,
    actor?: SecretAuditActor,
  ) {
    const isTitleValid = isValidLength(name, this.TITLE_LENGTH);
    if (!isTitleValid) return E.left(TEAM_ENVIRONMENT_SHORT_NAME);

    const storedVariables = this.writeVariables(JSON.parse(variables));

    const result = await this.prisma.teamEnvironment.create({
      data: {
        name,
        teamID,
        variables: storedVariables as Prisma.JsonArray,
      },
    });

    await this.auditService.record({
      teamID,
      environmentID: result.id,
      environmentName: result.name,
      action: TeamSecretAuditAction.CREATE,
      secretKeys: secretKeysOf(storedVariables),
      actorUid: actor?.uid,
      actorEmail: actor?.email,
    });

    const createdTeamEnvironment = this.cast(result);

    this.pubsub.publish(
      `team_environment/${createdTeamEnvironment.teamID}/created`,
      createdTeamEnvironment,
    );

    return E.right(createdTeamEnvironment);
  }

  /**
   * Delete a TeamEnvironment.
   *
   * @param id TeamEnvironment ID
   * @returns Either of boolean or error message
   */
  async deleteTeamEnvironment(id: string, actor?: SecretAuditActor) {
    try {
      const result = await this.prisma.teamEnvironment.delete({
        where: {
          id,
        },
      });

      await this.auditService.record({
        teamID: result.teamID,
        environmentID: result.id,
        environmentName: result.name,
        action: TeamSecretAuditAction.DELETE,
        secretKeys: secretKeysOf(toVariableList(result.variables)),
        actorUid: actor?.uid,
        actorEmail: actor?.email,
      });

      const deletedTeamEnvironment = this.cast(result);

      this.pubsub.publish(
        `team_environment/${deletedTeamEnvironment.teamID}/deleted`,
        deletedTeamEnvironment,
      );

      return E.right(true);
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }

  /**
   * Update a TeamEnvironment.
   *
   * @param id TeamEnvironment ID
   * @param name TeamEnvironment name
   * @param variables JSONified string of contents of new TeamEnvironment
   * @returns Either of a TeamEnvironment or error message
   */
  async updateTeamEnvironment(
    id: string,
    name: string,
    variables: string,
    actor?: SecretAuditActor,
  ) {
    try {
      const isTitleValid = isValidLength(name, this.TITLE_LENGTH);
      if (!isTitleValid) return E.left(TEAM_ENVIRONMENT_SHORT_NAME);

      const storedVariables = this.writeVariables(JSON.parse(variables));

      const result = await this.prisma.teamEnvironment.update({
        where: { id },
        data: {
          name,
          variables: storedVariables as Prisma.JsonArray,
        },
      });

      await this.auditService.record({
        teamID: result.teamID,
        environmentID: result.id,
        environmentName: result.name,
        action: TeamSecretAuditAction.UPDATE,
        secretKeys: secretKeysOf(storedVariables),
        actorUid: actor?.uid,
        actorEmail: actor?.email,
      });

      const updatedTeamEnvironment = this.cast(result);

      this.pubsub.publish(
        `team_environment/${updatedTeamEnvironment.teamID}/updated`,
        updatedTeamEnvironment,
      );

      return E.right(updatedTeamEnvironment);
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }

  /**
   * Clear contents of a TeamEnvironment.
   *
   * @param id TeamEnvironment ID
   * @returns Either of a TeamEnvironment or error message
   */
  async deleteAllVariablesFromTeamEnvironment(
    id: string,
    actor?: SecretAuditActor,
  ) {
    try {
      // Read first: the update returns the emptied row, so the keys being
      // discarded are only knowable beforehand.
      const previous = await this.prisma.teamEnvironment.findUnique({
        where: { id },
        select: { variables: true },
      });

      const result = await this.prisma.teamEnvironment.update({
        where: { id: id },
        data: {
          variables: [],
        },
      });

      await this.auditService.record({
        teamID: result.teamID,
        environmentID: result.id,
        environmentName: result.name,
        action: TeamSecretAuditAction.DELETE,
        secretKeys: secretKeysOf(toVariableList(previous?.variables)),
        actorUid: actor?.uid,
        actorEmail: actor?.email,
      });

      const teamEnvironment = this.cast(result);

      this.pubsub.publish(
        `team_environment/${teamEnvironment.teamID}/updated`,
        teamEnvironment,
      );

      return E.right(teamEnvironment);
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }

  /**
   * Create a duplicate of a existing TeamEnvironment.
   *
   * @param id TeamEnvironment ID
   * @returns Either of a TeamEnvironment or error message
   */
  async createDuplicateEnvironment(id: string, actor?: SecretAuditActor) {
    try {
      const environment = await this.prisma.teamEnvironment.findFirstOrThrow({
        where: {
          id: id,
        },
      });

      // Ciphertext copies verbatim — no decrypt/re-encrypt round trip, so a
      // duplicate never materialises a secret in memory.
      const result = await this.prisma.teamEnvironment.create({
        data: {
          name: `${environment.name} - Duplicate`,
          teamID: environment.teamID,
          variables: environment.variables as Prisma.JsonArray,
        },
      });

      await this.auditService.record({
        teamID: result.teamID,
        environmentID: result.id,
        environmentName: result.name,
        action: TeamSecretAuditAction.CREATE,
        secretKeys: secretKeysOf(toVariableList(result.variables)),
        actorUid: actor?.uid,
        actorEmail: actor?.email,
      });

      const duplicatedTeamEnvironment = this.cast(result);

      this.pubsub.publish(
        `team_environment/${duplicatedTeamEnvironment.teamID}/created`,
        duplicatedTeamEnvironment,
      );

      return E.right(duplicatedTeamEnvironment);
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }

  /**
   * Fetch all TeamEnvironments of a team.
   *
   * @param teamID teamID of new TeamEnvironment
   * @returns List of TeamEnvironments
   */
  async fetchAllTeamEnvironments(teamID: string) {
    const result = await this.prisma.teamEnvironment.findMany({
      where: {
        teamID: teamID,
      },
    });
    const teamEnvironments = result.map((item) => {
      return this.cast(item);
    });

    return teamEnvironments;
  }

  /**
   * Fetch the count of environments for a given team.
   * @param teamID team id
   * @returns a count of team envs
   */
  async totalEnvsInTeam(teamID: string) {
    const envCount = await this.prisma.teamEnvironment.count({
      where: {
        teamID: teamID,
      },
    });
    return envCount;
  }

  /**
   * Get details of a TeamEnvironment for CLI.
   *
   * @param id TeamEnvironment ID
   * @param userUid User UID
   * @returns Either of a TeamEnvironment or error message
   */
  async getTeamEnvironmentForCLI(id: string, userUid: string) {
    try {
      const teamEnvironment =
        await this.prisma.teamEnvironment.findFirstOrThrow({
          where: { id },
        });

      const teamMember = await this.teamService.getTeamMember(
        teamEnvironment.teamID,
        userUid,
      );
      if (!teamMember) return E.left(TEAM_MEMBER_NOT_FOUND);

      const variables = this.readVariables(teamEnvironment.variables);

      await this.auditService.record({
        teamID: teamEnvironment.teamID,
        environmentID: teamEnvironment.id,
        environmentName: teamEnvironment.name,
        action: TeamSecretAuditAction.READ,
        secretKeys: secretKeysOf(variables),
        actorUid: userUid,
      });

      return E.right({ ...teamEnvironment, variables });
    } catch (error) {
      return E.left(TEAM_ENVIRONMENT_NOT_FOUND);
    }
  }
}
