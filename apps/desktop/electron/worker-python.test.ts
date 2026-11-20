import { describe, expect, it } from 'vitest';
import { buildWorkerEnv, resolveWorkerPython } from './worker-python.js';

describe('worker Python runtime resolution', () => {
  it('prefers explicit VMS_PYTHON override over bundled and system python', () => {
    const resolved = resolveWorkerPython({
      envPython: 'C:\\Custom\\python.exe',
      isPackaged: true,
      resourcesPath: 'C:\\App\\resources',
      platform: 'win32',
      fileExists: () => true,
    });
    expect(resolved).toEqual({ executable: 'C:\\Custom\\python.exe', bundled: false });
  });

  it('uses bundled resources/python/python.exe when packaged and present', () => {
    const resolved = resolveWorkerPython({
      isPackaged: true,
      resourcesPath: 'C:\\App\\resources',
      platform: 'win32',
      fileExists: (p) => p.endsWith('python.exe') && p.includes('resources'),
    });
    expect(resolved.bundled).toBe(true);
    expect(resolved.executable).toMatch(/resources[\\/]python[\\/]python\.exe$/);
  });

  it('falls back to system python in development or when bundled runtime is absent', () => {
    expect(resolveWorkerPython({
      isPackaged: false,
      resourcesPath: 'C:\\App\\resources',
      platform: 'win32',
      fileExists: () => true,
    })).toEqual({ executable: 'python', bundled: false });

    expect(resolveWorkerPython({
      isPackaged: true,
      resourcesPath: 'C:\\App\\resources',
      platform: 'win32',
      fileExists: () => false,
    })).toEqual({ executable: 'python', bundled: false });
  });

  it('clears PYTHONHOME and disables user-site when launching bundled python', () => {
    const env = buildWorkerEnv({
      baseEnv: { PATH: 'C:\\Windows\\System32', PYTHONHOME: 'C:\\BrokenPython27' },
      workerRoot: 'C:\\App\\resources\\worker',
      dataDir: 'C:\\Users\\test\\AppData\\Roaming\\VALORANT Montage Studio',
      parentPid: 1234,
      bundled: true,
    });
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.PYTHONNOUSERSITE).toBe('1');
    expect(env.PYTHONUTF8).toBe('1');
    expect(env.VMS_WORKER_PARENT_PID).toBe('1234');
  });
});
