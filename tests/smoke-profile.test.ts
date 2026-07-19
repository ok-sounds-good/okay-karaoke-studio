import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const profiles = require('../electron/smoke-profile.cjs') as {
  OWNER_FILE: string
  createOwnedSmokeProfile(prefix: string, options?: Record<string, unknown>): Promise<SmokeProfile>
  decodeProfileIdentity(identity: string, code: string): SmokeProfile['identity']
  pathsAreSeparate(left: string, right: string, pathApi?: typeof win32): boolean
  validateOwnedSmokeProfile(
    path: unknown,
    defaultPath: string,
    identity: unknown,
    code: string,
  ): string
  verifyRetainedSmokeProfile(
    profile: SmokeProfile,
    options?: Record<string, unknown>,
  ): Promise<{ retained: true }>
}

interface SmokeProfile {
  path: string
  identity: { dev: string; ino: string; realPath: string; token: string }
  serializedIdentity: string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}

describe('smoke profile identity', () => {
  it.each([
    ['same path', String.raw`C:\Users\singer\profile`, String.raw`C:\Users\singer\profile`, false],
    ['ancestor', String.raw`C:\Users\singer`, String.raw`C:\Users\singer\profile`, false],
    ['descendant', String.raw`C:\Users\singer\profile`, String.raw`C:\Users\singer`, false],
    ['sibling', String.raw`C:\Users\default`, String.raw`C:\Users\smoke`, true],
    ['different drive', String.raw`C:\Users\default`, String.raw`D:\smoke`, true],
    [
      'different UNC share',
      String.raw`\\server\default\profile`,
      String.raw`\\server\smoke\profile`,
      true,
    ],
  ])('classifies Windows %s deterministically', (_name, left, right, expected) => {
    expect(profiles.pathsAreSeparate(left, right, win32)).toBe(expected)
    expect(profiles.pathsAreSeparate(right, left, win32)).toBe(expected)
  })

  it('serializes bigint filesystem identities without precision loss', async () => {
    let lstatOptions: unknown
    const profile = await profiles.createOwnedSmokeProfile('owned-', {
      temporaryRoot: '/tmp',
      fsApi: {
        lstat: async (_path: string, options: unknown) => {
          lstatOptions = options
          return {
            dev: 9_007_199_254_740_993n,
            ino: 18_014_398_509_481_987n,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          }
        },
        mkdtemp: async () => '/tmp/owned-exact',
        realpath: async () => '/tmp/owned-exact',
        writeFile: async () => undefined,
      },
    })

    expect(lstatOptions).toEqual({ bigint: true })
    expect(profile.identity).toMatchObject({
      dev: '9007199254740993',
      ino: '18014398509481987',
    })
    expect(profiles.decodeProfileIdentity(profile.serializedIdentity, 'PROFILE_INVALID')).toEqual(
      profile.identity,
    )
  })

  it('validates the exact mkdtemp identity and deliberately retains it', async () => {
    const root = await temporaryRoot('oks-profile-root-')
    const defaultProfile = await temporaryRoot('oks-default-profile-')
    const profile = await profiles.createOwnedSmokeProfile('owned-', { temporaryRoot: root })

    expect(
      profiles.validateOwnedSmokeProfile(
        profile.path,
        defaultProfile,
        profile.serializedIdentity,
        'PROFILE_INVALID',
      ),
    ).toBe(profile.path)
    await expect(profiles.verifyRetainedSmokeProfile(profile)).resolves.toEqual({ retained: true })
    expect(await readFile(join(profile.path, profiles.OWNER_FILE), 'utf8')).toContain(
      profile.identity.token,
    )
  })

  it('rejects a profile nested inside the real default profile', async () => {
    const defaultProfile = await temporaryRoot('oks-default-profile-')
    const profile = await profiles.createOwnedSmokeProfile('nested-', {
      temporaryRoot: defaultProfile,
    })

    expect(() =>
      profiles.validateOwnedSmokeProfile(
        profile.path,
        defaultProfile,
        profile.serializedIdentity,
        'PROFILE_INVALID',
      ),
    ).toThrow('PROFILE_INVALID')
  })

  it('rejects a symlink or junction even when it reaches the original identity', async () => {
    const root = await temporaryRoot('oks-profile-root-')
    const defaultProfile = await temporaryRoot('oks-default-profile-')
    const profile = await profiles.createOwnedSmokeProfile('owned-', { temporaryRoot: root })
    const displaced = join(root, 'displaced')
    await rename(profile.path, displaced)
    await symlink(displaced, profile.path, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() =>
      profiles.validateOwnedSmokeProfile(
        profile.path,
        defaultProfile,
        profile.serializedIdentity,
        'PROFILE_INVALID',
      ),
    ).toThrow('PROFILE_INVALID')
  })

  it('rejects a replacement directory that copied the private owner token', async () => {
    const root = await temporaryRoot('oks-profile-root-')
    const defaultProfile = await temporaryRoot('oks-default-profile-')
    const profile = await profiles.createOwnedSmokeProfile('owned-', { temporaryRoot: root })
    const displaced = join(root, 'displaced')
    await rename(profile.path, displaced)
    await mkdir(profile.path)
    await writeFile(
      join(profile.path, profiles.OWNER_FILE),
      `${JSON.stringify({ token: profile.identity.token })}\n`,
    )

    expect(() =>
      profiles.validateOwnedSmokeProfile(
        profile.path,
        defaultProfile,
        profile.serializedIdentity,
        'PROFILE_INVALID',
      ),
    ).toThrow('PROFILE_INVALID')
  })

  it('never removes a directory or symlink swapped in before retention verification', async () => {
    const root = await temporaryRoot('oks-profile-root-')
    const profile = await profiles.createOwnedSmokeProfile('owned-', { temporaryRoot: root })
    const displaced = join(root, 'displaced')

    await expect(
      profiles.verifyRetainedSmokeProfile(profile, {
        beforeIdentityCheck: async () => {
          await rename(profile.path, displaced)
          await mkdir(profile.path)
          await writeFile(join(profile.path, 'racer-sentinel'), 'preserve racer')
        },
      }),
    ).rejects.toThrow('SMOKE_PROFILE_IDENTITY_MISMATCH')
    expect(await readFile(join(profile.path, 'racer-sentinel'), 'utf8')).toBe('preserve racer')
    expect(await readFile(join(displaced, profiles.OWNER_FILE), 'utf8')).toContain(
      profile.identity.token,
    )
  })
})
