import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolveWorkerPythonOptions {
  envPython?: string;
  isPackaged: boolean;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
}

export interface ResolvedWorkerPython {
  executable: string;
  bundled: boolean;
}

export function resolveWorkerPython(options: ResolveWorkerPythonOptions): ResolvedWorkerPython {
  const override = options.envPython?.trim();
  if (override) return { executable: override, bundled: false };

  const platform = options.platform ?? process.platform;
  const checkExists = options.fileExists ?? existsSync;

  if (options.isPackaged && options.resourcesPath) {
    const candidate = join(options.resourcesPath, 'python', platform === 'win32' ? 'python.exe' : 'python3');
    if (checkExists(candidate)) return { executable: candidate, bundled: true };
  }

  return { executable: platform === 'win32' ? 'python' : 'python3', bundled: false };
}

export interface BuildWorkerEnvOptions {
  baseEnv: NodeJS.ProcessEnv;
  workerRoot: string;
  dataDir: string;
  parentPid: number;
  bundled: boolean;
}

export function buildWorkerEnv(options: BuildWorkerEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...options.baseEnv,
    PYTHONPATH: options.workerRoot,
    VMS_DATA_DIR: options.dataDir,
    VMS_WORKER_PARENT_PID: String(options.parentPid),
    PYTHONUTF8: '1',
  };
  if (options.bundled) {
    delete env.PYTHONHOME;
    env.PYTHONNOUSERSITE = '1';
  }
  return env;
}
