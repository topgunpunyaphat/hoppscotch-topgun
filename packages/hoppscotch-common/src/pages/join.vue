<template>
  <div class="flex min-h-screen flex-col items-center justify-between">
    <div
      v-if="!linkID"
      class="flex flex-1 flex-col items-center justify-center p-4"
    >
      <icon-lucide-alert-triangle class="svg-icons mb-2 opacity-75" />
      <h1 class="heading text-center">{{ t("team.invalid_invite_link") }}</h1>
      <p class="mt-2 text-center">
        {{ t("team.invalid_invite_link_description") }}
      </p>
    </div>

    <div
      v-else-if="loadingCurrentUser"
      class="flex flex-1 flex-col items-center justify-center p-4"
    >
      <HoppSmartSpinner />
    </div>

    <div
      v-else-if="currentUser === null"
      class="flex flex-1 flex-col items-center justify-center p-4"
    >
      <h1 class="heading">{{ t("team.login_to_continue") }}</h1>
      <p class="mt-2">{{ t("team.login_to_continue_description") }}</p>
      <HoppButtonPrimary
        :label="t('auth.login_to_hoppscotch')"
        class="mt-8"
        @click="invokeAction('modals.login.toggle')"
      />
    </div>

    <div v-else class="flex flex-1 flex-col items-center justify-center p-4">
      <HoppSmartSpinner v-if="loadingInfo" />

      <div v-else-if="errorMessage" class="flex flex-col items-center p-4">
        <icon-lucide-alert-triangle class="svg-icons mb-4" />
        <p>{{ errorMessage }}</p>
      </div>

      <div v-else-if="joined" class="flex flex-col items-center p-4">
        <h1 class="heading">
          {{ t("team.joined_team", { workspace: teamName }) }}
        </h1>
        <p class="mt-2 text-secondaryLight">
          {{ t("team.joined_team_description", { workspace: teamName }) }}
        </p>
        <HoppButtonSecondary
          to="/"
          :icon="IconHome"
          filled
          :label="t('app.home')"
          class="mt-8"
        />
      </div>

      <div v-else class="flex flex-col items-center p-4">
        <h1 class="heading">
          {{ t("team.join_team", { workspace: teamName }) }}
        </h1>
        <p class="mt-2 text-secondaryLight">
          {{ t("team.join_team_by_link_description", { role: roleLabel }) }}
        </p>
        <HoppButtonPrimary
          :label="t('team.join_team', { workspace: teamName })"
          :loading="joining"
          class="mt-8"
          @click="join"
        />
      </div>
    </div>

    <div class="p-4">
      <HoppButtonSecondary
        class="!font-bold tracking-wide !text-secondaryDark"
        :label="t('app.name')"
        to="/"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import * as E from "fp-ts/Either"
import { computed, onBeforeMount, onMounted, ref } from "vue"
import { useRoute } from "vue-router"

import { onLoggedIn } from "@composables/auth"
import { useReadonlyStream } from "@composables/stream"
import { invokeAction } from "@helpers/actions"
import { useI18n } from "~/composables/i18n"
import { initializeApp } from "~/helpers/app"
import { runGQLQuery } from "~/helpers/backend/GQLClient"
import { GetTeamInviteLinkInfoDocument } from "~/helpers/backend/graphql"
import {
  joinTeamByInviteLink,
  type JoinTeamByInviteLinkErrors,
} from "~/helpers/backend/mutations/TeamInviteLink"
import { platform } from "~/platform"
import IconHome from "~icons/lucide/home"

const t = useI18n()
const route = useRoute()

const linkID = ref("")
const loadingInfo = ref(true)
const joining = ref(false)
const joined = ref(false)
const teamName = ref("")
const role = ref("")
const errorMessage = ref("")

const probableUser = useReadonlyStream(
  platform.auth.getProbableUserStream(),
  platform.auth.getProbableUser()
)
const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

const loadingCurrentUser = computed(
  () => !!probableUser.value && !currentUser.value
)

// Roles are shown as the raw uppercase enum everywhere else in the team UI
// (see teams/Invite.vue), so this matches rather than inventing labels.
const roleLabel = computed(() => role.value || "EDITOR")

const describe = (error: string) => {
  switch (error) {
    case "team_invite_link/not_found":
      return t("team.invite_link_not_found")
    case "team_invite_link/inactive":
      return t("team.invite_link_inactive")
    case "team_invite/already_member":
      return t("team.already_member")
    default:
      return t("error.something_went_wrong")
  }
}

const loadInfo = async () => {
  loadingInfo.value = true
  const result = await runGQLQuery({
    query: GetTeamInviteLinkInfoDocument,
    variables: { linkID: linkID.value },
  })

  if (E.isRight(result)) {
    teamName.value = result.right.teamInviteLinkInfo.teamName
    role.value = result.right.teamInviteLinkInfo.role
  } else {
    errorMessage.value =
      result.left.type === "network_error"
        ? t("error.network_error")
        : describe(result.left.error as string)
  }
  loadingInfo.value = false
}

const join = async () => {
  joining.value = true
  const result = await joinTeamByInviteLink(linkID.value)()
  joining.value = false

  if (E.isRight(result)) {
    joined.value = true
    return
  }

  errorMessage.value =
    result.left.type === "network_error"
      ? t("error.network_error")
      : describe(result.left.error as JoinTeamByInviteLinkErrors)
}

onBeforeMount(() => initializeApp())

onMounted(() => {
  if (typeof route.query.link === "string") linkID.value = route.query.link
})

onLoggedIn(async () => {
  if (platform.auth.getProbableUser() !== null) {
    await platform.auth.waitProbableLoginToConfirm()
  }
  if (linkID.value) await loadInfo()
})
</script>
