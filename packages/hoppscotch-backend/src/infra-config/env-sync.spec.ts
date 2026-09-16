import { InfraConfigEnum } from 'src/types/InfraConfig';

const mockFindMany = jest.fn();
jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    infraConfig: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    onModuleDestroy: jest.fn(),
  })),
}));

import { syncInfraConfigWithEnvFile } from './helper';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mockFindMany.mockReset();
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'cfg-1',
  name: InfraConfigEnum.GOOGLE_ALLOWED_DOMAINS,
  value: 'old.example.com',
  isEncrypted: false,
  lastSyncedEnvFileValue: 'old.example.com',
  ...overrides,
});

describe('syncInfraConfigWithEnvFile — GOOGLE_ALLOWED_DOMAINS', () => {
  test('is one of the keys the .env file stays authoritative for', async () => {
    mockFindMany.mockResolvedValue([]);

    await syncInfraConfigWithEnvFile();

    const requestedNames = mockFindMany.mock.calls[0][0].where.name.in;
    expect(requestedNames).toContain(InfraConfigEnum.GOOGLE_ALLOWED_DOMAINS);
  });

  test('picks up a changed .env value so the allowlist is not frozen at first boot', async () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = 'new.example.com';
    mockFindMany.mockResolvedValue([row()]);

    const updates = await syncInfraConfigWithEnvFile();

    expect(updates).toEqual([
      {
        id: 'cfg-1',
        value: 'new.example.com',
        lastSyncedEnvFileValue: 'new.example.com',
      },
    ]);
  });

  test('leaves the row alone when the .env value is unchanged', async () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = 'old.example.com';
    mockFindMany.mockResolvedValue([row()]);

    await expect(syncInfraConfigWithEnvFile()).resolves.toEqual([]);
  });

  test('does not clobber an admin-set value when the key is absent from .env', async () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    mockFindMany.mockResolvedValue([
      row({ value: 'set-by-admin.example.com' }),
    ]);

    await expect(syncInfraConfigWithEnvFile()).resolves.toEqual([]);
  });

  test('seeds a null row from .env without overwriting on the legacy path', async () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = 'seed.example.com';
    mockFindMany.mockResolvedValue([
      row({ value: null, lastSyncedEnvFileValue: null }),
    ]);

    await expect(syncInfraConfigWithEnvFile()).resolves.toEqual([
      {
        id: 'cfg-1',
        value: 'seed.example.com',
        lastSyncedEnvFileValue: 'seed.example.com',
      },
    ]);
  });
});
