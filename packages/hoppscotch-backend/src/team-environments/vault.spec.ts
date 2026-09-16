import {
  decryptSecretVariables,
  encryptSecretVariables,
  isVaultValue,
  secretKeysOf,
  stripSecretValues,
  toVariableList,
  VAULT_VALUE_PREFIX,
} from './vault';

// `encrypt`/`decrypt` read this at call time, so setting it here is enough.
const ORIGINAL_KEY = process.env.DATA_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = '12345678901234567890123456789012';
});
afterAll(() => {
  process.env.DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
});

const secret = (key: string, initialValue: string, currentValue = '') => ({
  key,
  initialValue,
  currentValue,
  secret: true,
});

const plain = (key: string, initialValue: string, currentValue = '') => ({
  key,
  initialValue,
  currentValue,
  secret: false,
});

describe('toVariableList', () => {
  test('returns an empty list for non-array input', () => {
    expect(toVariableList(null)).toEqual([]);
    expect(toVariableList(undefined)).toEqual([]);
    expect(toVariableList('nope')).toEqual([]);
  });

  test('drops entries that are not plain objects', () => {
    expect(toVariableList([plain('a', '1'), null, 'x', ['y']])).toEqual([
      plain('a', '1'),
    ]);
  });
});

describe('encryptSecretVariables', () => {
  test('encrypts a secret initialValue behind the vault prefix', () => {
    const [out] = encryptSecretVariables([secret('token', 's3cr3t')]);

    expect(isVaultValue(out.initialValue)).toBe(true);
    expect(out.initialValue).not.toContain('s3cr3t');
  });

  test('leaves non-secret values untouched', () => {
    const [out] = encryptSecretVariables([plain('base_url', 'https://x.test')]);
    expect(out.initialValue).toBe('https://x.test');
  });

  test("blanks a secret's currentValue, which is a per-user override", () => {
    const [out] = encryptSecretVariables([secret('token', 's3cr3t', 'mine')]);
    expect(out.currentValue).toBe('');
  });

  test('passes non-secret variables through untouched', () => {
    const input = plain('base_url', 'https://x.test', 'mine');
    expect(encryptSecretVariables([input])[0]).toBe(input);
  });

  test('is idempotent — re-encrypting an already stored value is a no-op', () => {
    const once = encryptSecretVariables([secret('token', 's3cr3t')]);
    const twice = encryptSecretVariables(once);
    expect(twice[0].initialValue).toBe(once[0].initialValue);
  });

  test('leaves an empty secret empty rather than encrypting a blank', () => {
    const [out] = encryptSecretVariables([secret('token', '')]);
    expect(out.initialValue).toBe('');
  });

  test('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecretVariables([secret('token', 's3cr3t')])[0];
    const b = encryptSecretVariables([secret('token', 's3cr3t')])[0];
    expect(a.initialValue).not.toBe(b.initialValue);
  });
});

describe('decryptSecretVariables', () => {
  test('round-trips a secret back to its plaintext', () => {
    const stored = encryptSecretVariables([secret('token', 's3cr3t')]);
    expect(decryptSecretVariables(stored)[0].initialValue).toBe('s3cr3t');
  });

  test('round-trips values with unicode and separators intact', () => {
    const value = 'p@ss:สวัสดี:1234';
    const stored = encryptSecretVariables([secret('token', value)]);
    expect(decryptSecretVariables(stored)[0].initialValue).toBe(value);
  });

  test('blanks a legacy plaintext secret that carries no vault prefix', () => {
    const [out] = decryptSecretVariables([secret('token', 'leaked-plaintext')]);
    expect(out.initialValue).toBe('');
  });

  test('blanks rather than throws when the ciphertext is corrupt', () => {
    const [out] = decryptSecretVariables([
      secret('token', `${VAULT_VALUE_PREFIX}not-valid-ciphertext`),
    ]);
    expect(out.initialValue).toBe('');
  });

  test('blanks rather than throws when the encryption key no longer matches', () => {
    const stored = encryptSecretVariables([secret('token', 's3cr3t')]);
    process.env.DATA_ENCRYPTION_KEY = '99999999999999999999999999999999';

    expect(decryptSecretVariables(stored)[0].initialValue).toBe('');

    process.env.DATA_ENCRYPTION_KEY = '12345678901234567890123456789012';
  });

  test('leaves non-secret values untouched', () => {
    const [out] = decryptSecretVariables([plain('base_url', 'https://x.test')]);
    expect(out.initialValue).toBe('https://x.test');
  });
});

describe('stripSecretValues', () => {
  test('blanks secret values but keeps their keys', () => {
    const [out] = stripSecretValues([secret('token', 's3cr3t', 'mine')]);
    expect(out).toMatchObject({
      key: 'token',
      initialValue: '',
      currentValue: '',
    });
  });

  test('passes non-secret variables through untouched', () => {
    const input = plain('base_url', 'https://x.test', 'mine');
    expect(stripSecretValues([input])[0]).toBe(input);
  });

  test('hides a stored secret when the vault is switched off', () => {
    const stored = encryptSecretVariables([secret('token', 's3cr3t')]);
    expect(stripSecretValues(stored)[0].initialValue).toBe('');
  });
});

describe('secretKeysOf', () => {
  test('lists only secret keys, never their values', () => {
    const keys = secretKeysOf([
      secret('token', 's3cr3t'),
      plain('base_url', 'https://x.test'),
      secret('api_key', 'k'),
    ]);
    expect(keys).toEqual(['token', 'api_key']);
  });
});
