import { Service } from "dioc"
import { ref } from "vue"
import * as E from "fp-ts/Either"

import { runGQLQuery } from "~/helpers/backend/GQLClient"
import { GetTeamSecretVaultStatusDocument } from "~/helpers/backend/graphql"

/**
 * Tracks whether this backend shares team secret values through the server.
 *
 * The server is the authority — it strips secrets on both read and write while
 * the vault is off — so this flag only decides whether the client bothers
 * sending them. It fails closed: any error leaves the vault off, which is the
 * behaviour that shares nothing.
 */
export class TeamSecretVaultService extends Service {
  public static readonly ID = "TEAM_SECRET_VAULT_SERVICE"

  public isEnabled = ref(false)

  private fetched = false

  public async refresh() {
    const result = await runGQLQuery({
      query: GetTeamSecretVaultStatusDocument,
      variables: {},
    })

    this.isEnabled.value = E.isRight(result)
      ? result.right.isTeamSecretVaultEnabled
      : false
    this.fetched = true

    return this.isEnabled.value
  }

  /** Resolve the flag, querying only on the first call. */
  public async ensureLoaded() {
    if (!this.fetched) await this.refresh()
    return this.isEnabled.value
  }
}
