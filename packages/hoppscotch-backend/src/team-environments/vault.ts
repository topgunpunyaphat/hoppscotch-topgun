import { decrypt, encrypt } from 'src/utils';

/**
 * Marker on a stored secret value. Rows written before the vault existed hold
 * a blank `initialValue` (the client stripped it), so the prefix is what
 * separates "encrypted by us" from "legacy or hand-edited plaintext" without
 * guessing from the ciphertext shape.
 */
export const VAULT_VALUE_PREFIX = 'vault:v1:';

/**
 * Shape of one environment variable as it travels on the wire. Extra fields
 * are preserved untouched so this stays forward-compatible with schema bumps.
 */
export type EnvVariable = Record<string, unknown> & {
  key?: unknown;
  secret?: unknown;
  initialValue?: unknown;
  currentValue?: unknown;
};

const isSecret = (variable: EnvVariable) => variable?.secret === true;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

export const isVaultValue = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(VAULT_VALUE_PREFIX);

/**
 * Names of the secret variables in a list, for the audit trail. Only keys are
 * recorded — never values, which would defeat the point of encrypting them.
 */
export const secretKeysOf = (variables: readonly EnvVariable[]): string[] =>
  variables.filter(isSecret).map((variable) => asString(variable.key));

/**
 * Encrypt every secret's `initialValue` for storage, blanking the secret's
 * `currentValue` (a per-user override that must never be shared). Non-secret
 * variables pass through byte-for-byte so this stays a vault-only concern.
 * Already-encrypted values are left alone, making this safe to re-run.
 */
export const encryptSecretVariables = (
  variables: readonly EnvVariable[],
): EnvVariable[] =>
  variables.map((variable) => {
    if (!isSecret(variable)) return variable;

    const value = asString(variable.initialValue);
    if (value === '' || isVaultValue(value))
      return { ...variable, currentValue: '' };

    return {
      ...variable,
      initialValue: VAULT_VALUE_PREFIX + encrypt(value),
      currentValue: '',
    };
  });

/**
 * Reverse of `encryptSecretVariables`. A value that fails to decrypt — a
 * rotated `DATA_ENCRYPTION_KEY`, a truncated row — yields a blank rather than
 * throwing, so one bad variable cannot make a whole environment unfetchable.
 */
export const decryptSecretVariables = (
  variables: readonly EnvVariable[],
): EnvVariable[] =>
  variables.map((variable) => {
    if (!isSecret(variable)) return variable;

    const stored = asString(variable.initialValue);
    if (!isVaultValue(stored)) return { ...variable, initialValue: '' };

    try {
      return {
        ...variable,
        initialValue: decrypt(stored.slice(VAULT_VALUE_PREFIX.length)),
      };
    } catch {
      return { ...variable, initialValue: '' };
    }
  });

/**
 * Blank every secret value. Used on both read and write while the vault is
 * disabled, so a stale client cannot persist secrets the admin has switched
 * off, and cannot read back ones stored while it was on.
 */
export const stripSecretValues = (
  variables: readonly EnvVariable[],
): EnvVariable[] =>
  variables.map((variable) =>
    isSecret(variable)
      ? { ...variable, initialValue: '', currentValue: '' }
      : variable,
  );

/** Parse a stored/incoming `variables` payload into a list, tolerating junk. */
export const toVariableList = (value: unknown): EnvVariable[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is EnvVariable =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
};
