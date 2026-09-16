import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { TeamAccessRole } from 'src/team/team.model';

@ObjectType()
export class TeamInviteLink {
  @Field(() => ID, { description: 'ID of the invite link' })
  id: string;

  @Field(() => ID, { description: 'ID of the team the link joins' })
  teamID: string;

  @Field(() => ID, { description: 'UID of the user who created the link' })
  creatorUid: string;

  @Field(() => TeamAccessRole, {
    description: 'Role granted to whoever joins through this link',
  })
  role: TeamAccessRole;

  @Field(() => Date, {
    nullable: true,
    description: 'When the link stops working, null if it never expires',
  })
  expiresOn: Date | null;

  @Field(() => Number, {
    nullable: true,
    description: 'How many times the link may be used, null if unlimited',
  })
  maxUses: number | null;

  @Field(() => Number, { description: 'How many times the link has been used' })
  useCount: number;

  @Field(() => Date, {
    nullable: true,
    description: 'When the link was revoked, null if still live',
  })
  revokedAt: Date | null;

  @Field(() => Date, { description: 'When the link was created' })
  createdOn: Date;

  @Field(() => Boolean, {
    description:
      'Whether the link can still be used right now — false once revoked, expired, or out of uses',
  })
  active: boolean;
}
