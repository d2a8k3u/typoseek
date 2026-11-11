import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { COMMAND_TIMEOUT_MS, runCommand } from '../support/command.ts';
import { installPackedPackage, PACKED_INSTALL_TIMEOUT_MS, type PackedInstall } from '../support/pack.ts';

const fixtureSource = fileURLToPath(new URL('fixture', import.meta.url));

const SMOKE_SCRIPT = 'smoke.mjs';
const SMOKE_HIT_IDS = [1];

let install: PackedInstall;

beforeAll(async () => {
  install = await installPackedPackage(fixtureSource);
  return install.remove;
}, PACKED_INSTALL_TIMEOUT_MS);

describe('packed typoseek tarball on other runtimes', { timeout: COMMAND_TIMEOUT_MS }, () => {
  test.for([
    { runtime: 'bun', args: [SMOKE_SCRIPT] },
    {
      runtime: 'deno',
      args: ['run', '--node-modules-dir=manual', '--allow-read', '--allow-env', SMOKE_SCRIPT],
    },
  ])('runs one search under $runtime from the fixture node_modules', async ({ runtime, args }) => {
    const output = await runCommand(runtime, args, { cwd: install.fixtureDirectory });
    expect(JSON.parse(output)).toEqual(SMOKE_HIT_IDS);
  });
});
