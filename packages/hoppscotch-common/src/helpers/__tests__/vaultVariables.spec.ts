import { beforeEach, describe, expect, it } from "vitest"

import { getService } from "~/modules/dioc"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import {
  hydrateVaultSecrets,
  stripClientLocalValuesForVaultWire,
} from "../clientLocalVariables"

const ENV_ID = "team-env-1"

const secret = (key: string, initialValue: string, currentValue = "") => ({
  key,
  initialValue,
  currentValue,
  secret: true,
})

const plain = (key: string, initialValue: string, currentValue = "") => ({
  key,
  initialValue,
  currentValue,
  secret: false,
})

describe("stripClientLocalValuesForVaultWire", () => {
  it("keeps a secret's initialValue, which is what the team shares", () => {
    const [result] = stripClientLocalValuesForVaultWire([
      secret("token", "shared-secret"),
    ])

    expect(result.initialValue).toBe("shared-secret")
  })

  it("still drops currentValue, which stays a per-user override", () => {
    const result = stripClientLocalValuesForVaultWire([
      secret("token", "shared-secret", "my-own"),
      plain("base_url", "https://x.test", "my-own"),
    ])

    expect(result.map((v) => v.currentValue)).toEqual(["", ""])
  })

  it("keeps non-secret initialValues untouched", () => {
    const [result] = stripClientLocalValuesForVaultWire([
      plain("base_url", "https://x.test"),
    ])

    expect(result.initialValue).toBe("https://x.test")
  })
})

describe("hydrateVaultSecrets", () => {
  let secretEnvironmentService: SecretEnvironmentService

  beforeEach(() => {
    secretEnvironmentService = getService(SecretEnvironmentService)
    secretEnvironmentService.deleteSecretEnvironment(ENV_ID)
  })

  it("seeds a secret value for a member who has none stored locally", () => {
    hydrateVaultSecrets(ENV_ID, [secret("token", "from-vault")])

    expect(
      secretEnvironmentService.getSecretEnvironmentVariableValue(ENV_ID, 0)
    ).toEqual({ value: "from-vault", initialValue: "from-vault" })
  })

  it("does not overwrite a value this user already set locally", () => {
    secretEnvironmentService.addSecretEnvironment(ENV_ID, [
      { key: "token", value: "my-own", varIndex: 0, initialValue: "my-own" },
    ])

    hydrateVaultSecrets(ENV_ID, [secret("token", "from-vault")])

    expect(
      secretEnvironmentService.getSecretEnvironmentVariableValue(ENV_ID, 0)
        ?.value
    ).toBe("my-own")
  })

  it("still surfaces the shared value as initialValue under a local override", () => {
    secretEnvironmentService.addSecretEnvironment(ENV_ID, [
      { key: "token", value: "my-own", varIndex: 0, initialValue: "my-own" },
    ])

    hydrateVaultSecrets(ENV_ID, [secret("token", "from-vault")])

    expect(
      secretEnvironmentService.getSecretEnvironmentVariableValue(ENV_ID, 0)
        ?.initialValue
    ).toBe("from-vault")
  })

  it("is a no-op for values when the vault is off and the server sends blanks", () => {
    hydrateVaultSecrets(ENV_ID, [secret("token", "")])

    expect(
      secretEnvironmentService.getSecretEnvironmentVariableValue(ENV_ID, 0)
        ?.value
    ).toBe("")
  })

  it("indexes secrets by their position in the full variable list", () => {
    hydrateVaultSecrets(ENV_ID, [
      plain("base_url", "https://x.test"),
      secret("token", "from-vault"),
    ])

    expect(
      secretEnvironmentService.getSecretEnvironmentVariable(ENV_ID, 1)?.key
    ).toBe("token")
    expect(
      secretEnvironmentService.getSecretEnvironmentVariable(ENV_ID, 0)
    ).toBeUndefined()
  })

  it("ignores a blank entity id rather than writing under an empty key", () => {
    hydrateVaultSecrets("", [secret("token", "from-vault")])

    expect(secretEnvironmentService.getSecretEnvironment("")).toBeUndefined()
  })
})
