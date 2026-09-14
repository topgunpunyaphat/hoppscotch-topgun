import { isEmailDomainAllowed, parseAllowedEmailDomains } from './helper';

describe('parseAllowedEmailDomains', () => {
  test('returns an empty list for unset, null or blank input', () => {
    expect(parseAllowedEmailDomains(undefined)).toEqual([]);
    expect(parseAllowedEmailDomains(null)).toEqual([]);
    expect(parseAllowedEmailDomains('')).toEqual([]);
    expect(parseAllowedEmailDomains('   ')).toEqual([]);
  });

  test('splits, trims and lowercases entries', () => {
    expect(parseAllowedEmailDomains(' Topgun.COM , example.org ')).toEqual([
      'topgun.com',
      'example.org',
    ]);
  });

  test('tolerates a leading @ and empty slots from stray commas', () => {
    expect(parseAllowedEmailDomains('@topgun.com,,example.org,')).toEqual([
      'topgun.com',
      'example.org',
    ]);
  });
});

describe('isEmailDomainAllowed', () => {
  test('allows everything when no allowlist is configured', () => {
    expect(isEmailDomainAllowed('anyone@gmail.com', [])).toBe(true);
  });

  test('admits an address on an allowed domain, case-insensitively', () => {
    const allowed = ['topgun.com'];
    expect(isEmailDomainAllowed('dev@topgun.com', allowed)).toBe(true);
    expect(isEmailDomainAllowed('DEV@TopGun.COM', allowed)).toBe(true);
  });

  test('rejects an address outside the allowlist', () => {
    expect(isEmailDomainAllowed('outsider@gmail.com', ['topgun.com'])).toBe(
      false,
    );
  });

  test('does not match on suffix or prefix of an allowed domain', () => {
    const allowed = ['topgun.com'];
    expect(isEmailDomainAllowed('a@nottopgun.com', allowed)).toBe(false);
    expect(isEmailDomainAllowed('a@topgun.com.evil.io', allowed)).toBe(false);
  });

  test('requires subdomains to be listed explicitly', () => {
    expect(isEmailDomainAllowed('a@mail.topgun.com', ['topgun.com'])).toBe(
      false,
    );
    expect(isEmailDomainAllowed('a@mail.topgun.com', ['mail.topgun.com'])).toBe(
      true,
    );
  });

  test('takes the domain after the LAST @, so a quoted local part cannot spoof one', () => {
    expect(
      isEmailDomainAllowed('"weird@topgun.com"@evil.io', ['topgun.com']),
    ).toBe(false);
  });

  test('rejects malformed addresses when an allowlist is set', () => {
    expect(isEmailDomainAllowed('no-at-sign', ['topgun.com'])).toBe(false);
    expect(isEmailDomainAllowed('trailing@', ['topgun.com'])).toBe(false);
  });

  test('admits any listed domain when several are configured', () => {
    const allowed = ['topgun.com', 'topgunthailand.com'];
    expect(isEmailDomainAllowed('a@topgunthailand.com', allowed)).toBe(true);
    expect(isEmailDomainAllowed('a@other.com', allowed)).toBe(false);
  });
});
