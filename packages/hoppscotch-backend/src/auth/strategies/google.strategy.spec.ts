import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, mockReset } from 'jest-mock-extended';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';

import { UserService } from 'src/user/user.service';
import { AuthService } from '../auth.service';
import { GoogleStrategy } from './google.strategy';
import {
  AUTH_EMAIL_DOMAIN_NOT_ALLOWED,
  AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH,
} from 'src/errors';

const mockUserService = mockDeep<UserService>();
const mockAuthService = mockDeep<AuthService>();

let allowedDomains: string | undefined;

const mockConfigService = {
  get: jest.fn((key: string) => {
    switch (key) {
      case 'INFRA.GOOGLE_ALLOWED_DOMAINS':
        return allowedDomains;
      case 'INFRA.GOOGLE_SCOPE':
        return 'email,profile';
      case 'INFRA.ALLOW_SECURE_COOKIES':
        return 'false';
      default:
        return 'stub';
    }
  }),
};

const strategy = new GoogleStrategy(
  mockUserService,
  mockAuthService,
  mockConfigService as any,
);

const profileFor = (email: string) =>
  ({
    id: 'google-123',
    provider: 'google',
    displayName: 'Someone',
    emails: [{ value: email }],
    photos: [{ value: 'https://example.test/p.png' }],
  }) as any;

const validate = (email: string) =>
  strategy.validate({} as any, 'at', 'rt', profileFor(email), jest.fn());

beforeEach(() => {
  mockReset(mockUserService);
  mockReset(mockAuthService);
  allowedDomains = undefined;
});

describe('GoogleStrategy.validate — email domain allowlist', () => {
  describe('with no allowlist configured', () => {
    test('lets any Google account through and auto-provisions it', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(O.none);
      mockUserService.createUserSSO.mockResolvedValue({
        uid: 'new-uid',
      } as any);

      await expect(validate('anyone@gmail.com')).resolves.toMatchObject({
        uid: 'new-uid',
      });
      expect(mockUserService.createUserSSO).toHaveBeenCalled();
    });
  });

  describe('with an allowlist configured', () => {
    beforeEach(() => {
      allowedDomains = 'topgunthailand.com';
    });

    test('rejects an address outside the allowlist', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(O.none);

      await expect(validate('outsider@gmail.com')).rejects.toThrow(
        new UnauthorizedException(AUTH_EMAIL_DOMAIN_NOT_ALLOWED),
      );
    });

    test('does NOT auto-provision an account for a rejected address', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(O.none);

      await expect(validate('outsider@gmail.com')).rejects.toThrow();

      expect(mockUserService.createUserSSO).not.toHaveBeenCalled();
      // Rejected before any lookup — a wrong domain must not even probe
      // whether an account exists.
      expect(mockUserService.findUserByEmail).not.toHaveBeenCalled();
    });

    test('admits an address on the allowed domain and provisions it', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(O.none);
      mockUserService.createUserSSO.mockResolvedValue({
        uid: 'staff-uid',
      } as any);

      await expect(validate('dev@topgunthailand.com')).resolves.toMatchObject({
        uid: 'staff-uid',
      });
    });

    test('admits an existing user on the allowed domain', async () => {
      const existing = {
        uid: 'existing-uid',
        displayName: 'Someone',
        photoURL: 'https://example.test/p.png',
      };
      mockUserService.findUserByEmail.mockResolvedValue(
        O.some(existing) as any,
      );
      mockAuthService.checkIfProviderAccountExists.mockResolvedValue(
        O.some({}) as any,
      );

      await expect(validate('dev@topgunthailand.com')).resolves.toMatchObject({
        uid: 'existing-uid',
      });
      expect(mockUserService.createUserSSO).not.toHaveBeenCalled();
    });

    test('blocks an existing user whose domain is no longer allowed', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(
        O.some({ uid: 'ex-staff' }) as any,
      );

      await expect(validate('exstaff@gmail.com')).rejects.toThrow(
        new UnauthorizedException(AUTH_EMAIL_DOMAIN_NOT_ALLOWED),
      );
    });

    test('rejects a lookalike domain', async () => {
      mockUserService.findUserByEmail.mockResolvedValue(O.none);

      await expect(validate('a@nottopgunthailand.com')).rejects.toThrow(
        new UnauthorizedException(AUTH_EMAIL_DOMAIN_NOT_ALLOWED),
      );
      await expect(validate('a@topgunthailand.com.evil.io')).rejects.toThrow(
        new UnauthorizedException(AUTH_EMAIL_DOMAIN_NOT_ALLOWED),
      );
    });

    test('still rejects a profile with no email at all', async () => {
      const noEmail = { id: 'g', provider: 'google', emails: [] } as any;

      await expect(
        strategy.validate({} as any, 'at', 'rt', noEmail, jest.fn()),
      ).rejects.toThrow(
        new UnauthorizedException(AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH),
      );
    });

    test('honours multiple domains and is case-insensitive', async () => {
      allowedDomains = ' TopgunThailand.com , topgun.co.th ';
      mockUserService.findUserByEmail.mockResolvedValue(O.none);
      mockUserService.createUserSSO.mockResolvedValue({ uid: 'u' } as any);

      await expect(validate('a@TOPGUN.CO.TH')).resolves.toBeDefined();
    });
  });
});
