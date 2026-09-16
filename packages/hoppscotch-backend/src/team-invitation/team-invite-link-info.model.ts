import { Field, ID, ObjectType } from '@nestjs/graphql';
import { TeamAccessRole } from 'src/team/team.model';

/**
 * The slice of a join link a prospective member is shown before joining.
 * Deliberately omits creator, usage counts and limits — those are the team
 * owner's business, and this query is open to any signed-in user.
 */
@ObjectType()
export class TeamInviteLinkInfo {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  teamID: string;

  @Field({ description: 'Name of the team being joined' })
  teamName: string;

  @Field(() => TeamAccessRole, { description: 'Role the joiner will get' })
  role: TeamAccessRole;
}
