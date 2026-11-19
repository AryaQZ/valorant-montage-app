import { contextBridge, ipcRenderer } from 'electron';
import type { VMSBridge } from '../shared/bridge.js';
import type { Project } from '../shared/project.js';

const bridge: VMSBridge = {
  getWorkerState: () => ipcRenderer.invoke('vms:worker-state'),
  importRecordings: () => ipcRenderer.invoke('vms:import-recordings'),
  detectKills: (source) => ipcRenderer.invoke('vms:detect-kills', source),
  aiReviewKills: (projectId, model, candidates) => ipcRenderer.invoke('vms:ai-review-kills', projectId, model, candidates),
  generateReferenceDraft: (project) => ipcRenderer.invoke('vms:reference-draft', project),
  readReferenceDraft: (project) => ipcRenderer.invoke('vms:reference-read', project),
  importMusic: () => ipcRenderer.invoke('vms:import-music'),
  selectStyleReference: () => ipcRenderer.invoke('vms:select-style-reference'),
  saveProject: (project, currentPath) => ipcRenderer.invoke('vms:save-project', project, currentPath),
  loadProject: (recover) => ipcRenderer.invoke('vms:load-project', recover),
  relinkRecording: (source) => ipcRenderer.invoke('vms:relink-recording', source),
  relinkMusic: (track) => ipcRenderer.invoke('vms:relink-music', track),
  relinkReference: () => ipcRenderer.invoke('vms:relink-reference'),
  autosaveProject: (project) => ipcRenderer.invoke('vms:autosave-project', project),
  render: (project, acknowledgements) => ipcRenderer.invoke('vms:render', project, acknowledgements),
  renderPreview: (project, mode, acknowledgements) => ipcRenderer.invoke('vms:render-preview', project, mode, acknowledgements),
  getRenderJob: (jobId) => ipcRenderer.invoke('vms:render-job', jobId),
  cancelRender: (jobId) => ipcRenderer.invoke('vms:cancel-render', jobId),
  revealLocalFile: (path) => ipcRenderer.invoke('vms:reveal-local-file', path),
  aiGetState: () => ipcRenderer.invoke('vms:ai-state'),
  aiConnect: () => ipcRenderer.invoke('vms:ai-connect'),
  aiReconnectSharing: () => ipcRenderer.invoke('vms:ai-reconnect-sharing'),
  aiAddAccount: () => ipcRenderer.invoke('vms:ai-add-account'),
  aiResumeSignIn: (profileId) => ipcRenderer.invoke('vms:ai-resume-sign-in', profileId),
  aiSelectProfile: (profileId) => ipcRenderer.invoke('vms:ai-select-profile', profileId),
  aiRefreshModels: () => ipcRenderer.invoke('vms:ai-refresh-models'),
  aiSetModel: (slug) => ipcRenderer.invoke('vms:ai-set-model', slug),
  aiSetEffort: (effort) => ipcRenderer.invoke('vms:ai-set-effort', effort),
  aiCancelSignIn: () => ipcRenderer.invoke('vms:ai-cancel-sign-in'),
  aiDisconnect: () => ipcRenderer.invoke('vms:ai-disconnect'),
  aiOpenUsage: () => ipcRenderer.invoke('vms:ai-open-usage'),
  aiTestInference: (projectId, model) => ipcRenderer.invoke('vms:ai-test-inference', projectId, model),
  aiGenerateProposal: (project, model) => ipcRenderer.invoke('vms:ai-generate-proposal', project, model),
  aiGetUsage: (projectId) => ipcRenderer.invoke('vms:ai-get-usage', projectId),
  aiCancelRequest: () => ipcRenderer.invoke('vms:ai-cancel-request'),
  onAIState(callback) {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('vms:ai-state-changed', listener);
    return () => ipcRenderer.removeListener('vms:ai-state-changed', listener);
  },
};

contextBridge.exposeInMainWorld('vms', bridge);

