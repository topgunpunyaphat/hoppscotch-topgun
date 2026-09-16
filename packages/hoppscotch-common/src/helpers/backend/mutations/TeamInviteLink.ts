import { runMutation } from "../GQLClient"
import {
  CreateTeamInviteLinkDocument,
  CreateTeamInviteLinkMutation,
  CreateTeamInviteLinkMutationVariables,
  JoinTeamByInviteLinkDocument,
  JoinTeamByInviteLinkMutation,
  JoinTeamByInviteLinkMutationVariables,
  TeamAccessRole,
} from "../graphql"

type CreateTeamInviteLinkErrors =
  | "team/not_required_role"
  | "team/member_not_found"
  | "team_invite_link/invalid_role"
  | "team_invite_link/invalid_limit"

export type JoinTeamByInviteLinkErrors =
  | "team_invite_link/not_found"
  | "team_invite_link/inactive"
  | "team_invite/already_member"

export const createTeamInviteLink = (
  teamID: string,
  role: TeamAccessRole
) =>
  runMutation<
    CreateTeamInviteLinkMutation,
    CreateTeamInviteLinkMutationVariables,
    CreateTeamInviteLinkErrors
  >(CreateTeamInviteLinkDocument, { teamID, role })

export const joinTeamByInviteLink = (linkID: string) =>
  runMutation<
    JoinTeamByInviteLinkMutation,
    JoinTeamByInviteLinkMutationVariables,
    JoinTeamByInviteLinkErrors
  >(JoinTeamByInviteLinkDocument, { linkID })
