import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron';
import { CHATGPT_USAGE_URL, ChatGPTError, createChatGPT, type ChatGPTClient,
  type ChatGPTModel, type LoginProfile, type SessionState } from '@siwc/local';
import type { AIState, AIDraftResult, KillCandidate, RenderJob, WorkerState } from '../shared/bridge.js';
import { rebuildTimeline, type Project } from '../shared/project.js';
import { validateAIProposal } from '../shared/director.js';
import { createElectronCredentialEncryption } from './credential-encryption.js';
import { requestLocalWorker } from './worker-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;
protocol.registerSchemesAsPrivileged([{ scheme: 'vms-media', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);
app.setName('VALORANT Montage Studio');
app.setPath('userData', join(app.getPath('appData'), 'VALORANT Montage Studio'));

const APP_ID = 'valorant-montage-studio';
const MAX_AI_REQUESTS_PER_PROJECT = 5;
const VIDEO_FILTERS = [{ name: 'Gameplay video', extensions: ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'avi', 'ts', 'mts'] }];
const AUDIO_FILTERS = [{ name: 'Music and audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'] }];

let mainWindow: BrowserWindow | undefined;
let worker: ChildProcess | undefined;
let workerPort: number | undefined;
let workerToken: string | undefined;
let chatgpt: ChatGPTClient | undefined;
let aiUnsubscribe: (() => void) | undefined;
let activeAiRequest: AbortController | undefined;
let aiRequestBusy = false;
let accountBusy = false;
let aiActivity = '';
let aiSession: SessionState = { status: 'disconnected', sharing: false };
let aiProfiles: LoginProfile[] = [];
let aiModels: ChatGPTModel[] = [];
let aiModelCatalog: AIState['modelCatalog'] = { status: 'idle', models: [] };
let selectedModel = '';
const aiUsage = new Map<string, number>();
const userApprovedProjectPaths = new Set<string>();
const userApprovedOutputArtifacts = new Set<string>();
const cacheMediaPaths = new Map<string, string>();

function repositoryRoot(): string {
  if (isPackaged) return join(process.resourcesPath, 'worker');
  let candidate = process.cwd();
  while (true) {
    if (candidate && isAbsolute(candidate)) {
      try {
        // The repo's top-level worker folder is the only accepted dev root.
        if (existsSync(join(candidate, 'services', 'worker', '__main__.py'))) return candidate;
      } catch { /* keep walking */ }
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error('Project worker folder could not be found. Run the desktop app from this repository.');
}

function workerDataDirectory(): string {
  return app.getPath('userData');
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temp, path);
}

async function loadLocalSettings(): Promise<void> {
  try {
    const settings = JSON.parse(await readFile(join(app.getPath('userData'), 'ai-settings.json'), 'utf8')) as { model?: unknown; usage?: unknown };
    if (typeof settings.model === 'string') selectedModel = settings.model;
    if (settings.usage && typeof settings.usage === 'object' && !Array.isArray(settings.usage)) {
      for (const [projectId, count] of Object.entries(settings.usage)) {
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0) aiUsage.set(projectId, count);
      }
    }
  } catch { /* first launch */ }
}

async function persistAISettings(): Promise<void> {
  const usage = Object.fromEntries(aiUsage.entries());
  await atomicWrite(join(app.getPath('userData'), 'ai-settings.json'), JSON.stringify({ model: selectedModel, usage }, null, 2));
}

function findCredentialWorker(): Promise<void> {
  const root = repositoryRoot();
  const logDirectory = join(app.getPath('userData'), 'logs');
  const workerLog = join(logDirectory, 'worker.log');
  return mkdir(logDirectory, { recursive: true }).then(() => new Promise<void>((resolveReady, rejectReady) => {
    const python = process.env.VMS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, ['-m', 'services.worker'], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root, VMS_DATA_DIR: workerDataDirectory() },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    worker = child;
    const logStream = createWriteStream(workerLog, { flags: 'a', encoding: 'utf8' });
    child.stderr.pipe(logStream);
    let settled = false;
    const startupTimeout = setTimeout(() => finish(new Error('Local worker startup timed out after 20 seconds. Check Python 3.11+ installation.')), 20_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (error) rejectReady(error);
      else resolveReady();
    };
    child.once('error', (error) => finish(new Error(`Could not launch Python worker: ${error.message}`)));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Local worker exited during startup (${code ?? 'unknown'}). Check ${workerLog}`));
      workerPort = undefined;
      workerToken = undefined;
    });
    let data = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      data += chunk;
      const lineEnd = data.indexOf('\n');
      if (lineEnd < 0) return;
      const line = data.slice(0, lineEnd).trim();
      try {
        const ready = JSON.parse(line) as { type?: string; port?: number; token?: string };
        if (ready.type !== 'ready' || !Number.isInteger(ready.port) || !ready.token || ready.token.length < 32) {
          throw new Error('Worker readiness message was invalid.');
        }
        workerPort = ready.port;
        workerToken = ready.token;
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Worker readiness message was invalid.'));
      }
    });
  }));
}

async function workerRequest<T>(method: 'GET' | 'POST' | 'DELETE', route: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
  const port = workerPort;
  const token = workerToken;
  if (!worker || worker.exitCode !== null || !port || !token) throw new Error('The local media worker is not connected.');
  return requestLocalWorker<T>({ port, token, method, route, body, timeoutMs });
}

function assertRenderer(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('This request is not allowed from this renderer.');
  }
}

function safeAIError(error: unknown): string {
  const code = error instanceof ChatGPTError ? error.code :
    error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'subscription_sharing_usage_limit_exceeded') return 'ChatGPT plan usage limit reached for this app. Check ChatGPT Settings → Usage; the app will not switch to a paid API key.';
  if (code === 'subscription_sharing_usage_unavailable') return 'ChatGPT plan usage is temporarily unavailable. Try again later; no API-key billing fallback is used.';
  if (code === 'sharing_not_enabled') return 'Identity is connected, but plan usage permission was not granted. Enable it with Continue with ChatGPT.';
  if (code === 'reauth_required' || code === 'invalid_grant' || code === 'token_expired') return 'Reconnect with ChatGPT to renew this connection.';
  if (code === 'cancelled' || code === 'AbortError') return 'The request was cancelled.';
  if (error instanceof Error && error.message.includes('OS credential encryption')) return 'Windows protected credential storage is unavailable. Sign-in is disabled until OS encryption is available.';
  return error instanceof ChatGPTError ? error.message : 'ChatGPT request did not complete. Try again or use the rule-only director.';
}

function makeAIState(): AIState {
  return { session: { ...aiSession }, profiles: [...aiProfiles], modelCatalog: { ...aiModelCatalog, models: [...aiModelCatalog.models] },
    selectedModel, accountBusy, aiBusy: aiRequestBusy, aiActivity };
}

function publishAIState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vms:ai-state-changed', makeAIState());
}

async function refreshAIState(): Promise<AIState> {
  if (!chatgpt) return makeAIState();
  try {
    aiSession = await chatgpt.getSession();
    aiProfiles = await chatgpt.listProfiles();
    if (aiSession.status === 'connected' && aiSession.sharing) {
      aiModelCatalog = { status: 'loading', models: [] };
      publishAIState();
      try {
        aiModels = await chatgpt.listModels();
        aiModelCatalog = { status: 'ready', models: [...aiModels] };
        const available = new Set(aiModels.map(model => model.slug));
        if (!available.has(selectedModel)) {
          selectedModel = available.has('gpt-6.1-sol') ? 'gpt-6.1-sol' : aiModels[0]?.slug ?? '';
          await persistAISettings();
        }
      } catch (error) {
        aiModels = [];
        aiModelCatalog = { status: 'error', models: [], message: safeAIError(error) };
      }
    } else {
      aiModels = [];
      aiModelCatalog = { status: 'idle', models: [] };
    }
  } catch (error) {
    aiSession = { status: 'reauth_required', sharing: false, error: { code: 'local_session_error', message: safeAIError(error), retryable: true } };
    aiProfiles = [];
    aiModels = [];
    aiModelCatalog = { status: 'error', models: [], message: safeAIError(error) };
  }
  publishAIState();
  return makeAIState();
}

function ensureChatGPT(): ChatGPTClient {
  if (!chatgpt) throw new Error('ChatGPT connection runtime is not ready.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
  return chatgpt;
}

function trustedWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The desktop window is not available.');
  return mainWindow;
}

function cacheRoot(): string {
  return join(app.getPath('userData'), 'cache');
}

function isInsideCache(pathValue: string): boolean {
  return isInsideDirectory(cacheRoot(), pathValue);
}

function isInsideDirectory(root: string, pathValue: string): boolean {
  const rel = relative(resolve(root), resolve(pathValue));
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function fileUrlForCache(pathValue: unknown): string | null {
  if (typeof pathValue !== 'string' || !isInsideCache(pathValue)) return null;
  const extension = extname(pathValue).toLowerCase();
  if (!['.mp4', '.png', '.jpg', '.jpeg'].includes(extension)) return null;
  const token = randomUUID();
  cacheMediaPaths.set(token, resolve(pathValue));
  return `vms-media://cache/${token}`;
}

function registerCacheMediaProtocol(): void {
  protocol.handle('vms-media', async (request) => {
    let token = '';
    try {
      const url = new URL(request.url);
      if (url.hostname === 'cache' && !url.search && !url.hash) token = url.pathname.slice(1);
    } catch { /* return a uniform not-found response for malformed URLs */ }
    if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Not found', { status: 404 });
    const pathValue = cacheMediaPaths.get(token);
    if (!pathValue || !isInsideCache(pathValue) || !existsSync(pathValue)) {
      cacheMediaPaths.delete(token);
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    try {
      const metadata = await stat(pathValue);
      const total = metadata.size;
      let start = 0;
      let end = Math.max(total - 1, 0);
      let status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]) || total === 0) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
        }
        if (!match[1]) {
          const suffixLength = Number(match[2]);
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
          }
          start = Math.max(total - suffixLength, 0);
        } else {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : total - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
          }
          end = Math.min(end, total - 1);
        }
        status = 206;
      }
      const extension = extname(pathValue).toLowerCase();
      const contentType = extension === '.mp4' ? 'video/mp4' : extension === '.png' ? 'image/png' : 'image/jpeg';
      const contentLength = Math.max(0, end - start + 1);
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Length': String(contentLength),
        'Content-Type': contentType,
      });
      if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      const body = request.method === 'HEAD' || total === 0 ? null :
        Readable.toWeb(createReadStream(pathValue, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, { status, headers });
    } catch {
      return new Response('Media unavailable', { status: 404 });
    }
  });
}

function startChatGPT(): void {
  const credentialEncryption = createElectronCredentialEncryption(safeStorage, () => app.isReady());
  chatgpt = createChatGPT({
    appName: 'VALORANT Montage Studio',
    appId: APP_ID,
    sendHostId: true,
    redirectPort: 0,
    storageDir: join(app.getPath('userData'), 'chatgpt'),
    credentialEncryption,
    openBrowser: async (url) => {
      const target = new URL(url);
      if (target.origin !== 'https://auth.openai.com') throw new Error('Unexpected ChatGPT sign-in destination.');
      await shell.openExternal(target.href);
    },
  });
  aiUnsubscribe = chatgpt.subscribe((session) => {
    aiSession = session;
    if (session.status !== 'connected' || !session.sharing) {
      aiModels = [];
      aiModelCatalog = { status: 'idle', models: [] };
    }
    publishAIState();
  });
}

function safeProjectMetadata(project: Project): Record<string, unknown> {
  if (project.events.length > 250) throw new Error('AI Director is capped at 250 manually reviewed events per request.');
  const markers = project.music?.beat_grid ?? [];
  if (markers.length > 3000) throw new Error('AI Director is capped at 3,000 beat candidates per request.');
  const payload = {
    project_id: project.project_id,
    style: 'smooth_clean',
    beat_priority: project.settings.beat_sync_priority,
    effects_intensity: project.settings.effects_intensity,
    output: { width: 2560, height: 1440, fps: project.settings.output_profile === 'master_144' ? 144 : 60,
      profile: project.settings.output_profile },
    events: project.events.map(event => ({ event_id: event.event_id, source_time_us: event.source_time_us,
      in_us: event.in_us, out_us: event.out_us, owner: event.owner, confidence: event.confidence,
      tags: event.tags, cluster_id: event.cluster_id })),
    music: project.music ? { duration_us: project.music.duration_us, bpm_estimate: project.music.bpm_estimate,
      confidence: project.music.confidence, beat_grid: markers.map(marker => ({ marker_id: marker.marker_id,
        time_us: marker.time_us, confidence: marker.confidence })) } : null,
  };
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > 100_000) throw new Error('Structured AI planning metadata exceeded the 100 KB request cap.');
  return payload;
}

function aiInstructions(error?: string): string {
  return [
    'You are the VALORANT Montage Studio Creative Director. Return one JSON object only, with no Markdown fences or prose outside JSON.',
    'The object must use schema_version:1 and only the fields listed below.',
    'Use only event IDs and beat marker IDs supplied in the user input. Never invent a kill or a timestamp.',
    'Preserve every confidence >= 0.75 multikill event. Keep each event impact inside its clip source range.',
    'Make an editable proposal only. Do not claim that cuts are beat-aligned unless the selected marker is within 80 ms of that event impact after preceding clip durations.',
    'Each selected event must appear exactly once, either as a clip plan event_id or in that plan\'s included_event_ids. Strongly overlapping events from the same source may share one sequence only when every impact stays visible.',
    'Allowed fields: selected_event_ids:string[], clip_plans:[{event_id:string,included_event_ids?:string[],in_us:integer,out_us:integer,slot:integer}], beat_targets:[{marker_id:string,impact_event_id:string,intended_time_us:integer}], effects:[{event_id:string,type:"impact_zoom",max_zoom:number}], rationale:string[], confidence:number, warnings:string[].',
    'Effects must remain within the supplied Smooth/Clean intensity range. Keep reasons brief and refer only to supplied evidence.',
    ...(error ? [`The previous JSON failed local validation: ${error}. Return a corrected complete object.`] : []),
  ].join('\n');
}

function consumeAIRequest(projectId: string): number {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(projectId)) throw new Error('Invalid project ID for AI request cap.');
  const count = aiUsage.get(projectId) ?? 0;
  if (count >= MAX_AI_REQUESTS_PER_PROJECT) throw new Error(`Per-project ChatGPT request cap reached (${MAX_AI_REQUESTS_PER_PROJECT}). Use the rule-only director or start another project.`);
  const next = count + 1;
  aiUsage.set(projectId, next);
  void persistAISettings();
  return next;
}

function requireLiveModel(model: string): void {
  if (aiSession.status !== 'connected' || !aiSession.sharing) throw new Error('ChatGPT plan usage is not enabled for the connected account.');
  if (!aiModels.some(item => item.slug === model)) throw new Error('Selected model is not in the active account catalog. Refresh the model list.');
}

async function requestChatGPT(model: string, payload: Record<string, unknown>, instructions: string, projectId: string): Promise<{ text: string; count: number }> {
  const runtime = ensureChatGPT();
  requireLiveModel(model);
  const count = consumeAIRequest(projectId);
  const controller = new AbortController();
  activeAiRequest = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
  aiRequestBusy = true;
  aiActivity = 'Sending structured metadata to ChatGPT';
  publishAIState();
  try {
    const result = await runtime.streamResponse({
      model,
      instructions,
      input: [{ role: 'user', content: JSON.stringify(payload) }],
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new ChatGPTError('cancelled', 'The request was cancelled.');
    if (!result.text.trim()) throw new Error('ChatGPT completed without an edit plan.');
    return { text: result.text, count };
  } catch (error) {
    if (timedOut) throw new Error('ChatGPT request timed out after 90 seconds. You can try again or use the rule-only director.');
    const message = safeAIError(error);
    aiSession = { ...aiSession, error: { code: error instanceof ChatGPTError ? error.code : 'inference_failed', message, retryable: true } };
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
    if (activeAiRequest === controller) activeAiRequest = undefined;
    aiRequestBusy = false;
    aiActivity = '';
    await refreshAIState();
  }
}

function parseJsonOnly(text: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new Error('The response was not valid JSON.'); }
}

function setupIpc(): void {
  ipcMain.handle('vms:worker-state', async (event) => {
    assertRenderer(event);
    const state = await workerRequest<WorkerState>('GET', '/v1/capabilities');
    return state;
  });

  ipcMain.handle('vms:import-recordings', async (event) => {
    assertRenderer(event);
    const selection = await dialog.showOpenDialog(trustedWindow(), { title: 'Import gameplay recordings', properties: ['openFile', 'multiSelections'], filters: VIDEO_FILTERS });
    if (selection.canceled) return [];
    const media = [];
    for (const path of selection.filePaths) {
      const item = await workerRequest<Record<string, unknown>>('POST', '/v1/media/import', { path }, 60 * 60_000);
      item.preview_url = fileUrlForCache(item.proxy_path);
      item.thumbnail_url = fileUrlForCache(item.thumbnail_path);
      media.push(item);
    }
    return media;
  });

  ipcMain.handle('vms:detect-kills', async (event, source: { media_id: string; path: string }) => {
    assertRenderer(event);
    if (!source || typeof source.media_id !== 'string' || typeof source.path !== 'string') throw new Error('Invalid source selected for kill review.');
    return workerRequest<{ candidates: KillCandidate[]; upstream_commit: string; status: string }>(
      'POST', '/v1/events/detect', { source_media_id: source.media_id, path: source.path }, 60 * 60_000);
  });

  ipcMain.handle('vms:import-music', async (event) => {
    assertRenderer(event);
    const selection = await dialog.showOpenDialog(trustedWindow(), { title: 'Import music you are licensed to use', properties: ['openFile'], filters: AUDIO_FILTERS });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0];
    const metadata = await workerRequest<Record<string, unknown>>('POST', '/v1/music/probe', { path });
    const analysis = await workerRequest<Record<string, unknown>>('POST', '/v1/music/analyze', { path }, 60 * 60_000);
    return { ...metadata, ...analysis, rights_acknowledged: false, offset_us: 0 };
  });

  ipcMain.handle('vms:save-project', async (event, project: Project, currentPath?: string | null) => {
    assertRenderer(event);
    const validation = await workerRequest<{ project: Project }>('POST', '/v1/project/validate', { project });
    project = validation.project;
    let path = currentPath && isAbsolute(currentPath) && userApprovedProjectPaths.has(resolve(currentPath))
      ? resolve(currentPath) : undefined;
    if (!path) {
      const selection = await dialog.showSaveDialog(trustedWindow(), { title: 'Save VALORANT Montage project',
        defaultPath: `${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.vmsproj.json`,
        filters: [{ name: 'VMS project JSON', extensions: ['json'] }] });
      if (selection.canceled || !selection.filePath) return null;
      path = selection.filePath;
    }
    await atomicWrite(path, `${JSON.stringify(project, null, 2)}\n`);
    userApprovedProjectPaths.add(resolve(path));
    await workerRequest('POST', '/v1/library/index', { project, json_path: path });
    return { path };
  });

  ipcMain.handle('vms:load-project', async (event) => {
    assertRenderer(event);
    const selection = await dialog.showOpenDialog(trustedWindow(), { title: 'Open montage project', properties: ['openFile'],
      filters: [{ name: 'VMS project JSON', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0];
    const imported = JSON.parse(await readFile(path, 'utf8')) as Project;
    const validation = await workerRequest<{ project: Project }>('POST', '/v1/project/validate', { project: imported });
    const project = validation.project;
    userApprovedProjectPaths.add(resolve(path));
    for (const source of project.sources) {
      source.preview_url = fileUrlForCache(source.proxy_path);
      source.thumbnail_url = fileUrlForCache(source.thumbnail_path);
    }
    return { project, path };
  });

  ipcMain.handle('vms:autosave-project', async (event, project: Project) => {
    assertRenderer(event);
    const validation = await workerRequest<{ project: Project }>('POST', '/v1/project/validate', { project });
    project = validation.project;
    const path = join(app.getPath('userData'), 'autosave', `${project.project_id}.vmsproj.json`);
    await atomicWrite(path, `${JSON.stringify(project, null, 2)}\n`);
    await workerRequest('POST', '/v1/library/index', { project, json_path: path });
    return { path };
  });

  ipcMain.handle('vms:render', async (event, project: Project, acknowledgements: { rights: boolean; ownership: boolean }) => {
    assertRenderer(event);
    const selection = await dialog.showSaveDialog(trustedWindow(), { title: 'Export montage MP4', defaultPath: `${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.mp4`,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (selection.canceled || !selection.filePath) return null;
    if (extname(selection.filePath).toLowerCase() !== '.mp4') throw new Error('Export path must use .mp4.');
    const outputPath = resolve(selection.filePath);
    userApprovedOutputArtifacts.add(outputPath);
    userApprovedOutputArtifacts.add(outputPath.replace(/\.mp4$/i, '.project.json'));
    userApprovedOutputArtifacts.add(outputPath.replace(/\.mp4$/i, '.qa.json'));
    userApprovedOutputArtifacts.add(outputPath.replace(/\.mp4$/i, '.qa.html'));
    const body = { project, output_path: outputPath, rights_acknowledged: Boolean(acknowledgements?.rights),
      ownership_acknowledged: Boolean(acknowledgements?.ownership) };
    const preflight = await workerRequest<{ errors: string[]; warnings: string[]; duration_us: number }>('POST', '/v1/render/preflight', body);
    if (preflight.errors.length) throw new Error(preflight.errors.join('\n'));
    const job = await workerRequest<{ job_id: string }>('POST', '/v1/render', body);
    return { job_id: job.job_id, output_path: outputPath };
  });

  ipcMain.handle('vms:render-preview', async (event, project: Project,
    mode: 'rough_preview' | 'effects_preview', acknowledgements: { rights: boolean; ownership: boolean }) => {
    assertRenderer(event);
    if (mode !== 'rough_preview' && mode !== 'effects_preview') throw new Error('Preview mode is invalid.');
    const previewProject = structuredClone(project);
    previewProject.settings.output_profile = mode === 'rough_preview' ? 'preview_30' : 'youtube_60';
    rebuildTimeline(previewProject);
    const outputPath = join(cacheRoot(), 'previews', `${previewProject.project_id}-${mode}-${Date.now()}.mp4`);
    await mkdir(dirname(outputPath), { recursive: true });
    const body = { project: previewProject, output_path: outputPath,
      rights_acknowledged: Boolean(acknowledgements?.rights),
      ownership_acknowledged: Boolean(acknowledgements?.ownership), render_mode: mode };
    const preflight = await workerRequest<{ errors: string[] }>('POST', '/v1/render/preflight', body);
    if (preflight.errors.length) throw new Error(preflight.errors.join('\n'));
    const job = await workerRequest<{ job_id: string }>('POST', '/v1/render', body);
    const previewUrl = fileUrlForCache(outputPath);
    if (!previewUrl) throw new Error('Preview output could not be mapped into the local cache.');
    return { job_id: job.job_id, output_path: outputPath, preview_url: previewUrl };
  });

  ipcMain.handle('vms:render-job', async (event, jobId: string) => {
    assertRenderer(event);
    if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Invalid render job ID.');
    return workerRequest<RenderJob>('GET', `/v1/jobs/${jobId}`);
  });

  ipcMain.handle('vms:cancel-render', async (event, jobId: string) => {
    assertRenderer(event);
    if (typeof jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Invalid render job ID.');
    await workerRequest('DELETE', `/v1/jobs/${jobId}`);
  });

  ipcMain.handle('vms:reveal-local-file', async (event, path: string) => {
    assertRenderer(event);
    if (typeof path !== 'string' || !isAbsolute(path) || !['.mp4', '.html', '.json'].includes(extname(path).toLowerCase())) throw new Error('Only an absolute MP4/HTML/JSON path can be opened.');
    if (!isInsideCache(path) && !isInsideOutput(path) && !userApprovedProjectPaths.has(resolve(path))
        && !userApprovedOutputArtifacts.has(resolve(path))) throw new Error('File is outside user-approved project, cache, and output files.');
    const result = await shell.openPath(path);
    if (result) throw new Error(result);
  });

  ipcMain.handle('vms:ai-state', async (event) => { assertRenderer(event); return refreshAIState(); });
  ipcMain.handle('vms:ai-connect', async (event) => { assertRenderer(event); return signInWithChatGPT(); });
  ipcMain.handle('vms:ai-reconnect-sharing', async (event) => { assertRenderer(event); return signInWithChatGPT({ reconsent: true }); });
  ipcMain.handle('vms:ai-add-account', async (event) => { assertRenderer(event); return signInWithChatGPT({ newProfile: true }); });
  ipcMain.handle('vms:ai-resume-sign-in', async (event, profileId: string) => { assertRenderer(event); return signInWithChatGPT({ profileId: requireText(profileId, 100) }); });
  ipcMain.handle('vms:ai-select-profile', async (event, profileId: string) => {
    assertRenderer(event); ensureChatGPT();
    accountBusy = true; aiActivity = 'Switching ChatGPT account'; publishAIState();
    try { await chatgpt!.selectProfile(requireText(profileId, 100)); return await refreshAIState(); }
    catch (error) { aiSession = { ...aiSession, error: toSessionError(error) }; throw new Error(safeAIError(error)); }
    finally { accountBusy = false; aiActivity = ''; publishAIState(); }
  });
  ipcMain.handle('vms:ai-refresh-models', async (event) => {
    assertRenderer(event); ensureChatGPT();
    if (aiSession.status !== 'connected' || !aiSession.sharing) throw new Error('Grant ChatGPT plan usage before loading models.');
    aiModelCatalog = { status: 'loading', models: [] }; publishAIState();
    try { aiModels = await chatgpt!.listModels(); aiModelCatalog = { status: 'ready', models: aiModels }; return await refreshAIState(); }
    catch (error) { aiModels = []; aiModelCatalog = { status: 'error', models: [], message: safeAIError(error) }; publishAIState(); throw new Error(safeAIError(error)); }
  });
  ipcMain.handle('vms:ai-set-model', async (event, slug: string) => {
    assertRenderer(event);
    if (typeof slug !== 'string' || !aiModels.some(model => model.slug === slug)) throw new Error('Model must be selected from the active account catalog.');
    selectedModel = slug; await persistAISettings(); publishAIState(); return makeAIState();
  });
  ipcMain.handle('vms:ai-cancel-sign-in', async (event) => { assertRenderer(event); chatgpt?.cancelSignIn(); });
  ipcMain.handle('vms:ai-disconnect', async (event) => {
    assertRenderer(event); ensureChatGPT();
    accountBusy = true; aiActivity = 'Removing local credentials'; publishAIState();
    try { await chatgpt!.disconnect(); return await refreshAIState(); }
    catch (error) { aiSession = { ...aiSession, error: toSessionError(error) }; throw new Error(safeAIError(error)); }
    finally { accountBusy = false; aiActivity = ''; publishAIState(); }
  });
  ipcMain.handle('vms:ai-open-usage', async (event) => { assertRenderer(event); await shell.openExternal(CHATGPT_USAGE_URL); });
  ipcMain.handle('vms:ai-test-inference', async (event, projectId: string, model: string) => {
    assertRenderer(event);
    if (aiRequestBusy) throw new Error('Wait for the current ChatGPT request or cancel it.');
    const payload = { test: 'connection_check', app: APP_ID };
    const result = await requestChatGPT(model, payload, 'Reply with exactly the word OK. Do not call tools.', projectId);
    return { text: result.text, usageCount: result.count };
  });
  ipcMain.handle('vms:ai-generate-proposal', async (event, project: Project, model: string): Promise<AIDraftResult> => {
    assertRenderer(event);
    if (aiRequestBusy) throw new Error('Wait for the current ChatGPT request or cancel it.');
    await workerRequest('POST', '/v1/project/validate', { project });
    const metadata = safeProjectMetadata(project);
    let validationMessage = '';
    let lastCount = aiUsage.get(project.project_id) ?? 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await requestChatGPT(model, metadata, aiInstructions(validationMessage || undefined), project.project_id);
      lastCount = result.count;
      try {
        const proposal = validateAIProposal(parseJsonOnly(result.text), project);
        return { proposal, usageCount: lastCount };
      } catch (error) {
        validationMessage = error instanceof Error ? error.message : 'Local schema validation failed.';
        if (attempt === 1) throw new Error(`AI proposal failed local validation twice: ${validationMessage}`);
      }
    }
    throw new Error('AI proposal could not be created.');
  });
  ipcMain.handle('vms:ai-get-usage', async (event, projectId: string) => {
    assertRenderer(event);
    if (typeof projectId !== 'string') throw new Error('Project ID is required.');
    return aiUsage.get(projectId) ?? 0;
  });
  ipcMain.handle('vms:ai-cancel-request', async (event) => { assertRenderer(event); activeAiRequest?.abort(); });
}

function isInsideOutput(path: string): boolean {
  const outputFolder = join(app.getPath('videos'), 'VALORANT Montage Studio');
  return isInsideDirectory(outputFolder, path);
}

function requireText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error('Text parameter is missing or too long.');
  return value.trim();
}

function toSessionError(error: unknown): NonNullable<SessionState['error']> {
  if (error instanceof ChatGPTError) return error.toJSON();
  return { code: 'connection_error', message: safeAIError(error), retryable: true };
}

async function signInWithChatGPT(options: Parameters<ChatGPTClient['signIn']>[0] = {}): Promise<AIState> {
  ensureChatGPT();
  if (accountBusy) throw new Error('Finish the current account action first.');
  accountBusy = true; aiActivity = 'Continue sign-in in the system browser'; aiSession = { ...aiSession, status: 'connecting', error: undefined }; publishAIState();
  try {
    await chatgpt!.signIn(options);
    return await refreshAIState();
  } catch (error) {
    aiSession = { ...(await chatgpt!.getSession().catch(() => aiSession)), error: toSessionError(error) };
    aiProfiles = await chatgpt!.listProfiles().catch(() => aiProfiles);
    publishAIState();
    throw new Error(safeAIError(error));
  } finally { accountBusy = false; aiActivity = ''; publishAIState(); }
}

async function createWindow(): Promise<void> {
  const preloadPath = join(here, '../preload/index.cjs');
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1180, minHeight: 740,
    backgroundColor: '#0d1016', show: false,
    title: 'VALORANT Montage Studio',
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let approvedExternal = url === CHATGPT_USAGE_URL;
    try { approvedExternal ||= new URL(url).origin === 'https://auth.openai.com'; } catch { /* deny malformed URLs */ }
    if (approvedExternal) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      try { if (new URL(url).origin === new URL(devUrl).origin) return; } catch { /* deny malformed URLs */ }
    }
    const rendererFile = pathToFileURL(join(here, '../renderer/index.html')).href;
    if (url === rendererFile) return;
    event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(join(here, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

app.whenReady().then(async () => {
  registerCacheMediaProtocol();
  await loadLocalSettings();
  startChatGPT();
  await findCredentialWorker();
  setupIpc();
  await createWindow();
  void refreshAIState();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  dialog.showErrorBox('VALORANT Montage Studio startup failed', error instanceof Error ? error.message : 'Unknown startup error.');
  app.quit();
});

app.on('before-quit', () => {
  activeAiRequest?.abort();
  aiUnsubscribe?.();
  if (worker && worker.exitCode === null) worker.kill();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

