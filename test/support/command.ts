import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const COMMAND_TIMEOUT_MS = 60_000;

const execFileAsync = promisify(execFile);

export interface CommandOptions {
  readonly cwd: string;
  readonly input?: string;
}

export async function runCommand(command: string, args: readonly string[], options: CommandOptions): Promise<string> {
  const pending = execFileAsync(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS });
  pending.child.stdin?.end(options.input);
  const { stdout } = await pending;
  return stdout;
}
