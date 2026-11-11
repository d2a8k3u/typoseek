import { statSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { COMMAND_TIMEOUT_MS, runCommand } from './command.ts';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const TARBALL_ROOT = 'package/';
const PACK_LOCK = join(tmpdir(), 'typoseek-pack.lock');
const PACK_LOCK_STALE_MS = 2 * COMMAND_TIMEOUT_MS;
const PACK_LOCK_POLL_MS = 100;
const COMMANDS_PER_INSTALL = 3;

export const PACKED_INSTALL_TIMEOUT_MS = PACK_LOCK_STALE_MS + COMMANDS_PER_INSTALL * COMMAND_TIMEOUT_MS;

export interface PackedInstall {
  readonly fixtureDirectory: string;
  readonly packageDirectory: string;
  readonly packedFiles: readonly string[];
  readonly remove: () => Promise<void>;
}

export async function installPackedPackage(fixtureSource: string): Promise<PackedInstall> {
  const workspace = await mkdtemp(join(tmpdir(), 'typoseek-package-'));
  const remove = () => rm(workspace, { recursive: true, force: true });
  try {
    const tarball = await packTarball(workspace);
    const fixtureDirectory = join(workspace, 'fixture');
    await cp(fixtureSource, fixtureDirectory, { recursive: true });
    await runCommand(
      'npm',
      ['install', '--prefix', fixtureDirectory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
      { cwd: fixtureDirectory },
    );
    return {
      fixtureDirectory,
      packageDirectory: join(fixtureDirectory, 'node_modules', 'typoseek'),
      packedFiles: await listTarball(tarball, workspace),
      remove,
    };
  } catch (error) {
    await remove();
    throw error;
  }
}

async function packTarball(destination: string): Promise<string> {
  await withPackLock(() => runCommand('npm', ['pack', '--pack-destination', destination], { cwd: repositoryRoot }));
  const [tarball, ...extraTarballs] = (await readdir(destination)).filter((name) => name.endsWith('.tgz'));
  if (tarball === undefined || extraTarballs.length > 0) {
    throw new Error(`npm pack must leave exactly one tarball in ${destination}`);
  }
  return join(destination, tarball);
}

async function listTarball(tarball: string, cwd: string): Promise<string[]> {
  const listing = await runCommand('tar', ['-tzf', tarball], { cwd });
  return listing
    .split('\n')
    .filter((entry) => entry !== '')
    .map((entry) => {
      if (!entry.startsWith(TARBALL_ROOT)) {
        throw new Error(`tarball entry ${entry} lies outside ${TARBALL_ROOT}`);
      }
      return entry.slice(TARBALL_ROOT.length);
    });
}

async function withPackLock<T>(work: () => Promise<T>): Promise<T> {
  while (!(await tryCreatePackLock())) {
    assertPackLockFresh();
    await delay(PACK_LOCK_POLL_MS);
  }
  try {
    return await work();
  } finally {
    await rm(PACK_LOCK, { recursive: true, force: true });
  }
}

async function tryCreatePackLock(): Promise<boolean> {
  try {
    await mkdir(PACK_LOCK);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

function assertPackLockFresh(): void {
  const lock = statSync(PACK_LOCK, { throwIfNoEntry: false });
  if (lock !== undefined && Date.now() - lock.mtimeMs > PACK_LOCK_STALE_MS) {
    throw new Error(`${PACK_LOCK} outlived every pack, so an aborted run left it behind: remove it and rerun`);
  }
}
