import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';

const root = process.env.VMS_AUDIT_ROOT;
const repo = process.env.VMS_AUDIT_REPO;
const at = name => join(root, name);
const source = process.env.VMS_AUDIT_VIDEO;
const music = process.env.VMS_AUDIT_MUSIC;
const nativeProject = process.env.VMS_AUDIT_NATIVE_PROJECT;
const nativeExport = process.env.VMS_AUDIT_NATIVE_EXPORT === '1';
const restartCheck = process.env.VMS_AUDIT_RESTART_CHECK === '1';
const recoveryCheck = process.env.VMS_AUDIT_RECOVERY_CHECK === '1';
const crashCheck = process.env.VMS_AUDIT_CRASH_CHECK;
const afterCrash = process.env.VMS_AUDIT_AFTER_CRASH === '1';
const killReviewCheck = process.env.VMS_AUDIT_KILL_REVIEW_CHECK === '1';
const resumeKillReview = process.env.VMS_AUDIT_RESUME_KILL_REVIEW === '1';
const timelineCheck = process.env.VMS_AUDIT_TIMELINE_CHECK === '1';
let importCount = 0;
let saves = 0;
let exports = 0;
let opened = 0;
let relinks = 0;
let musicRelinks = 0;

if (process.argv[2] === 'stage') {
  const require = createRequire(join(repo, 'apps', 'desktop', 'package.json'));
  require('@electron/asar').extractAll(at('release/win-unpacked/resources/app.asar'), at('tested'));
  copyFileSync(new URL(import.meta.url), at('qa-app.mjs'));
  const main = at('tested/dist-electron/main/index.js');
  let code = readFileSync(main, 'utf8');
  const patch = [
    ['app.setPath("userData", join(app.getPath("appData"), "VALORANT Montage Studio"));', 'app.setPath("userData", join(process.env.VMS_AUDIT_ROOT,"profile"));'],
    ['  startChatGPT();', '  const harness = await import("../../../qa-app.mjs");\n  harness.setupDialogs(dialog);'],
    ['  void refreshAIState();\n  app.on("activate"', '  void harness.run(mainWindow, () => worker);\n  app.on("activate"'],
    ['  mainWindow.once("ready-to-show", () => mainWindow?.show());', ''],
  ];
  for (const [key, value] of patch) {
    if (!code.includes(key)) throw new Error('Packaged bundle no longer matches QA hook: ' + key);
    code = code.replace(key, value);
  }
  writeFileSync(main, code);
}

export function setupDialogs(dialog) {
  if (recoveryCheck) {
    const project = JSON.parse(readFileSync(at('saved.vmsproj.json'), 'utf8'));
    copyFileSync(source, at('Rekaman – relatif.mp4'));
    copyFileSync(music, at('Lagu – dipindah.mp3'));
    project.sources[0].path = 'Rekaman – relatif.mp4';
    project.sources[0].proxy_path = null;
    project.music.path = 'musik-yang-hilang.mp3';
    project.music.offset_us = 125000;
    delete project.music.file_sha256; // Recreate a project written before media fingerprints existed.
    project.reference_video = { path: 'referensi-yang-hilang.mp4', filename: 'referensi-yang-hilang.mp4' };
    project.settings.beat_sync_priority = 0;
    project.settings.output_profile = 'master_144';
    const event = project.events[0];
    const clip = project.timeline[0];
    event.in_us = clip.in_us = Math.max(0, event.source_time_us - 4000000);
    event.out_us = clip.out_us = Math.min(project.sources[0].duration_us, event.source_time_us + 4000000);
    clip.duration_frames = Math.round((clip.out_us - clip.in_us) * 144 / 1000000);
    clip.output_start_frame = 0;
    clip.time_remap = [{ source_start_us: clip.in_us, source_end_us: clip.out_us, output_start_frame: 0,
      output_end_frame: clip.duration_frames, speed_num: 1, speed_den: 1, direction: 'forward' }];
    clip.effects = [];
    writeFileSync(at('relative.vmsproj.json'), JSON.stringify(project));
  }
  dialog.showOpenDialog = async (_w, options) => {
    if (options.title.startsWith('Import gameplay')) {
      if (killReviewCheck) return { canceled: false, filePaths: [source] };
      return importCount++ === 0 ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [source, source] };
    }
    if (options.title.startsWith('Import music')) return { canceled: false, filePaths: [music] };
    if (options.title === 'Temukan kembali rekaman gameplay') {
      return relinks++ === 0 ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [source] };
    }
    if (options.title === 'Temukan kembali musik montage') {
      const paths = [null, source, at('Lagu – dipindah.mp3')];
      const chosen = paths[musicRelinks++];
      return chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] };
    }
    if (options.title === 'Temukan kembali video referensi') return { canceled: false, filePaths: [source] };
    if (options.title === 'Pulihkan autosave proyek') {
      const project = JSON.parse(readFileSync(at('saved.vmsproj.json'), 'utf8'));
      return { canceled: false, filePaths: [join(options.defaultPath, project.project_id + '.vmsproj.json')] };
    }
    if (nativeProject) return { canceled: false, filePaths: [nativeProject] };
    if (timelineCheck) return { canceled: false, filePaths: [at(['timeline.vmsproj.json', 'grouped.vmsproj.json', 'invalid-source.vmsproj.json'][opened++])] };
    if (killReviewCheck) return { canceled: false, filePaths: [at('kill-review.vmsproj.json')] };
    if (recoveryCheck) return { canceled: false, filePaths: [at('relative.vmsproj.json')] };
    return { canceled: false, filePaths: [at(['missing-proxy.vmsproj.json', 'bad.vmsproj.json', 'missing-media.vmsproj.json', 'copy – audit.vmsproj.json', 'copy – audit.vmsproj.json'][opened++])] };
  };
  dialog.showSaveDialog = async (_w, options) => ({
    canceled: false,
    filePath: options.title.startsWith('Export') ? at(nativeExport ? 'native-1080p60.mp4' : crashCheck ? 'app-interrupted.mp4' : recoveryCheck ? 'worker-interrupted.mp4' : 'master-' + (++exports) + '.mp4')
      : killReviewCheck ? at('kill-review.vmsproj.json') : at(saves++ === 0 ? 'saved.vmsproj.json' : 'copy – audit.vmsproj.json'),
  });
}

export async function run(win, getWorker) {
  const wc = win.webContents;
  const read = code => wc.executeJavaScript(code, true);
  const evidence = {};
  function log(key, value) {
    evidence[key] = value;
    const file = timelineCheck ? 'timeline-evidence.json' : killReviewCheck ? 'kill-review-evidence.json' : afterCrash ? 'after-crash-evidence.json' : crashCheck ? `crash-${crashCheck}-evidence.json` : recoveryCheck
      ? 'recovery-evidence.json' : restartCheck ? 'restart-evidence.json' : 'ui-evidence.json';
    writeFileSync(at(file), JSON.stringify(evidence, null, 2));
  }
  function need(condition, message) {
    if (!condition) throw new Error(message);
  }
  async function wait(code, timeout = 16000) {
    for (let elapsed = 0; elapsed < timeout; elapsed += 150) {
      if (await read(code)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timed out: ' + code);
  }
  async function click(label) {
    const find = '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===' + JSON.stringify(label) + '&&!b.disabled)';
    await wait('!!(' + find + ')');
    await read('(' + find + ').click()');
  }
  async function dismissNotice() {
    await read('document.querySelector(".toast button")?.click()');
  }
  async function edit(selector, value) {
    await read('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  }
  const verified = file => JSON.parse(readFileSync(at(file), 'utf8'));
  const profile = file => JSON.parse(execFileSync('ffprobe', ['-v','error','-count_frames','-show_streams','-show_format','-of','json',at(file)], { encoding:'utf8' }));
  try {
    await wait('!!document.querySelector(".version-label")');
    log('startup version', win.getTitle());
    if (timelineCheck) {
      await wait('document.querySelector(".toast")?.textContent.includes("Studio siap")', 35000);
      await click('Buka proyek');
      await wait('document.querySelector("video")?.readyState>=2', 60000);
      const labels = () => read('[...document.querySelectorAll(".timeline-clip")].map(e=>e.getAttribute("aria-label"))');
      const before = await labels();
      const ids = verified('timeline.vmsproj.json').timeline.map(clip => clip.event_id);
      async function saveOrder() {
        await dismissNotice();
        await click('Simpan proyek');
        await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
        return verified('timeline.vmsproj.json').timeline.map(clip => clip.event_id);
      }
      need(before.length === 5, 'Timeline fixture needs five confirmed shots.');
      await read('document.querySelectorAll(".timeline-clip")[1].click()');
      await click('Remove clip ×');
      await wait('document.querySelectorAll(".timeline-clip").length===4');
      await read('window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,cancelable:true}))');
      await wait('document.querySelectorAll(".timeline-clip").length===5');
      need(JSON.stringify(await saveOrder()) === JSON.stringify(ids), 'Undo lost the timeline order.');
      await read('window.dispatchEvent(new KeyboardEvent("keydown",{key:"y",ctrlKey:true,cancelable:true}))');
      await wait('document.querySelectorAll(".timeline-clip").length===4');
      await click('Masukkan ke montage');
      await wait('document.querySelectorAll(".timeline-clip").length===5');
      need((await saveOrder())[4] === ids[1], 'The removed highlight could not be added again.');
      await read('document.querySelectorAll(".timeline-clip")[4].dispatchEvent(new DragEvent("dragstart",{bubbles:true}))');
      await read('document.querySelectorAll(".timeline-clip")[1].dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true}))');
      need(JSON.stringify(await saveOrder()) === JSON.stringify(ids), 'Reorder did not restore the five impact IDs in their original order.');
      log('remove clip, undo, redo, re-add and reorder', ids);
      await read('document.querySelectorAll(".timeline-clip")[1].click()');
      const scrubber = 'input[aria-label="Posisi cuplikan"]';
      await wait('!!document.querySelector(' + JSON.stringify(scrubber) + ')');
      const rangeEnd = await read('Number(document.querySelector(' + JSON.stringify(scrubber) + ').max)');
      await edit(scrubber, String(rangeEnd - 0.1));
      await wait('Math.abs(document.querySelector("video").currentTime-' + (rangeEnd - 0.1) + ') < 0.08');
      await click('Putar cuplikan');
      await wait('document.querySelector("video").paused && Math.abs(document.querySelector("video").currentTime-' + rangeEnd + ') < 0.08');
      log('timeline clip seek and playback stopped at its source boundary', rangeEnd);
      const clipBeforeEdit = verified('timeline.vmsproj.json').timeline[1];
      const trimInput = '.trim-controls label:first-child input';
      const trimStart = Math.ceil(clipBeforeEdit.in_us / 10_000 + 3) / 100;
      await edit(trimInput, String(trimStart));
      const effect = '[...document.querySelectorAll(".effect-toggle")].find(label=>label.textContent.includes("Zoom saat kill"))?.querySelector("input")';
      await wait('!!(' + effect + ')');
      await read('if(!(' + effect + ').checked) (' + effect + ').click()');
      const zoom = '[...document.querySelectorAll(".slider-control label")].find(label=>label.textContent==="Impact zoom peak keyframe")';
      await wait('!!(' + zoom + ')');
      await edit('[id=' + JSON.stringify(await read('(' + zoom + ').htmlFor')) + ']', '1.05');
      await saveOrder();
      const edited = verified('timeline.vmsproj.json');
      const editedClip = edited.timeline[1];
      const anchor = edited.events.find(item => item.event_id === editedClip.event_id);
      const zoomEffect = editedClip.effects.find(item => item.type === 'impact_zoom');
      need(editedClip.in_us === Math.round(trimStart * 1e6) && editedClip.in_us <= anchor.source_time_us
        && anchor.source_time_us <= editedClip.out_us, 'Trim moved the selected impact outside the clip.');
      need(zoomEffect?.enabled && zoomEffect.keyframes.some(frame => frame.frame_offset === 0 && frame.scale === 1.05),
        'Zoom toggle or impact keyframe edit did not save.');
      log('trim and zoom keyframe persisted', { inUs: editedClip.in_us, impactUs: anchor.source_time_us, zoom: zoomEffect.max_zoom });
      await click('Buka proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka") && document.querySelectorAll(".timeline-clip").length===4');
      await read('document.querySelector(\'button[aria-label="Hapus highlight 00:24.20"]\').click()');
      await wait('document.querySelectorAll(".event-card").length===4');
      log('remaining clips after removing first highlight from a grouped clip', (await labels()).length);
      need((await labels()).length === 4, 'Removing one grouped highlight removed the other highlight from the montage.');
      await click('Simpan proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
      const grouped = verified('grouped.vmsproj.json');
      need(grouped.events.length === 4 && grouped.timeline[0].event_id === grouped.events[0].event_id
        && grouped.events[0].source_frame === 1540, 'Grouped clip did not retain its remaining reviewed impact.');
      log('grouped clip retained its surviving reviewed impact on save', true);
      await click('Buka proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka")');
      await click('Cari kill otomatis');
      await wait('!!document.querySelector(".toast.error")', 45000);
      need(await read('document.querySelectorAll(".timeline-clip").length===4 && document.querySelectorAll(".event-card").length===5'),
        'Detection failure lost existing clips or annotations.');
      await click('Tandai kill manual');
      for (const [index, value] of ['10.03','10.20','10.64'].entries()) await edit('.time-inputs label:nth-child('+(index+1)+') input', value);
      await click('Headshot');
      await click('Multikill');
      await edit('#manual-highlight select', 'unknown');
      await click('Simpan highlight');
      await wait('document.querySelectorAll(".event-card").length===6');
      await click('Simpan proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
      const annotation = verified('invalid-source.vmsproj.json').events.find(event => event.source_time_us === 10_200_000);
      need(annotation?.owner === 'unknown' && annotation.tags.includes('headshot') && annotation.tags.includes('multikill'),
        'The manual time, ownership or tags were not written to the project.');
      log('failed detection preserved existing edits and manual timestamp annotation remained usable', true);
      log('manual tags and ownership round trip', { time: annotation.source_time_us, tags: annotation.tags, owner: annotation.owner });
      log('finished', true);
      return;
    }
    if (killReviewCheck) {
      const count = '.candidate-card';
      const candidates = amount => 'document.querySelectorAll(' + JSON.stringify(count) + ').length===' + amount;
      const act = async (verb, time) => {
        const find = 'document.querySelector(' + JSON.stringify('button[aria-label="' + verb + time + '"]') + ')';
        await wait('!!(' + find + ')');
        await read('(' + find + ').click()');
      };
      const range = () => read('[...document.querySelectorAll(\'input[aria-label="Posisi cuplikan"]\')].map(e=>[Number(e.min),Number(e.max)])');
      if (!resumeKillReview) {
        await click('＋ Impor rekaman');
        await wait('document.querySelector("video")?.readyState>=2', 60000);
        await click('Cari kill otomatis');
        await wait(candidates(6), 240000);
        await act('Lihat cuplikan kill sekitar ', '00:35.50');
        await wait('(!!document.querySelector(\'input[aria-label="Posisi cuplikan"]\'))');
        const before = (await range())[0];
        await act('Abaikan kandidat sekitar ', '00:34.60');
        await wait(candidates(5));
        await act('Lihat cuplikan kill sekitar ', '00:35.50');
        await wait('(!!document.querySelector(\'input[aria-label="Posisi cuplikan"]\'))');
        const after = (await range())[0];
        need(before[0] > 35 && after[0] <= 33.51 && after[1] === before[1], 'Dismissed shot still constrained the last candidate.');
        log('last candidate lead-in before and after dismissing the rejected shot', { before, after });
        await click('Tampilkan kembali kandidat (1)');
        await wait(candidates(6));
        await act('Abaikan kandidat sekitar ', '00:34.60');
        await click('Simpan proyek');
        await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
      }
      need(verified('kill-review.vmsproj.json').dismissed_kill_candidates[0]?.source_frame === 2076, 'Candidate rejection was not persisted.');
      await click('Buka proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka")');
      await click('Cari kill otomatis');
      await wait('document.querySelector(".toast")?.textContent.includes("5 kandidat siap ditinjau")', 240000);
      await wait(candidates(5), 240000);
      const confirmed = ['00:24.20', '00:25.67', '00:28.50', '00:30.53', '00:35.50'];
      for (const time of confirmed) {
        await act('Konfirmasi kill sekitar ', time);
        await click('Masukkan ke montage');
      }
      await wait('document.querySelectorAll(".timeline-clip").length===5 && !document.querySelector(".candidate-card")');
      await click('Simpan proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
      const saved = verified('kill-review.vmsproj.json');
      need(saved.events.length === 5 && saved.timeline.length === 5, 'Expected five single-kill clips.');
      const summary = saved.timeline.map(clip => ({ in_us: clip.in_us, out_us: clip.out_us,
        actual: saved.events.filter(event => event.source_time_us >= clip.in_us && event.source_time_us < clip.out_us).map(event => event.source_frame) }));
      need(summary.every(item => item.actual.length === 1) && new Set(summary.map(item => item.actual[0])).size === 5,
        'Timeline clips duplicate or miss a confirmed kill.');
      log('dismissal survived reopening and new scan; five distinct single-kill windows', summary);
      log('finished', true);
      return;
    }
    if (recoveryCheck) {
      await wait('document.querySelector(".toast")?.textContent.includes("Studio siap")', 35000);
      const fixture = verified('relative.vmsproj.json');
      const autosave = 'profile/autosave/' + fixture.project_id + '.vmsproj.json';
      const beforeOpen = readFileSync(at(autosave));
      await click('Buka proyek');
      await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka") || !!document.querySelector(".toast.error")');
      need(!await read('!!document.querySelector(".toast.error")'), await read('document.querySelector(".toast")?.textContent'));
      const sourceOpened = await read('!!document.querySelector(".media-card") && !document.querySelector(".library-column .missing-recording")');
      log('relative source resolved', sourceOpened);
      const originalWorker = getWorker();
      const workerExited = once(originalWorker, 'exit');
      originalWorker.kill();
      await workerExited;
      const status = await read('window.vms.getWorkerState().then(s => s.worker_version, error => String(error))');
      log('worker restart result', status);
      need(sourceOpened, 'Relative source was marked missing.');
      need(getWorker()?.pid !== originalWorker.pid && !status.includes('Error'), 'Worker failed to restart.');
      await wait('document.querySelector("video")?.readyState>=2', 60000);
      await new Promise(resolve => setTimeout(resolve, 1400));
      need(readFileSync(at(autosave)).equals(beforeOpen), 'Opening a project overwrote a newer autosave.');
      log('opening original preserved newer autosave', true);
      await click('Temukan lagu asli');
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Temukan lagu asli"&&!b.disabled)');
      await click('Temukan lagu asli');
      await wait('document.querySelector(".toast.error")?.textContent.includes("salinan lagu asli")');
      await click('Temukan lagu asli');
      await wait('document.querySelector(".toast")?.textContent.includes("Musik terhubung kembali")');
      await click('Temukan video referensi');
      await wait('document.querySelector(".toast")?.textContent.includes("Video referensi terhubung kembali")');
      await wait('document.querySelector(".project-name small")?.textContent==="Tersimpan otomatis"');
      const updated = verified(autosave);
      need(updated.music.path === at('Lagu – dipindah.mp3') && updated.music.offset_us === fixture.music.offset_us, 'Music relink changed the offset or failed to save the moved file.');
      need(JSON.stringify(updated.music.beat_grid) === JSON.stringify(fixture.music.beat_grid), 'Relink changed the beat markers.');
      need(updated.reference_video.path === source && verified('relative.vmsproj.json').reference_video.path === fixture.reference_video.path, 'Reference relink failed or rewrote the source project.');
      log('cancel, reject wrong song, relink original music and reference', true);
    }
    if (crashCheck) {
      await click('Pulihkan autosave');
      await wait('document.querySelector(".toast")?.textContent.includes("Autosave dipulihkan") && document.querySelector("video")?.readyState>=2', 60000);
      if (crashCheck === 'idle') {
        log('interruption', { workerPid: getWorker().pid });
        process.exit(37);
      }
    }
    if (recoveryCheck || crashCheck) {
      if (recoveryCheck) await dismissNotice();
      await click('Ekspor video ↗');
      await wait('!!document.querySelector("dialog:modal")');
      await read('document.querySelectorAll("dialog input").forEach(input => { if (!input.checked) input.click(); })');
      await click('Pilih lokasi dan ekspor');
      const identifyPartial = () => readdirSync(at('.')).find(name => /^\.vms-[a-f0-9-]+\.partial\.mp4$/.test(name));
      let partial;
      for (let i = 0; i < 200 && !partial; i++) {
        partial = identifyPartial();
        if (!partial) await new Promise(resolve => setTimeout(resolve, 100));
      }
      need(partial, 'Active FFmpeg partial was not observed.');
      const activeWorker = getWorker();
      if (crashCheck) {
        log('interruption', { workerPid: activeWorker.pid, partial });
        process.exit(37);
      }
      const exited = once(activeWorker, 'exit');
      activeWorker.kill();
      await exited;
      await wait('document.querySelector(".toast.error")?.textContent.includes("Status render terputus")');
      for (let i = 0; i < 80 && existsSync(at(partial)); i++) await new Promise(resolve => setTimeout(resolve, 125));
      need(!existsSync(at(partial)) && !existsSync(at('worker-interrupted.mp4')), 'Worker crash left a partial or published output.');
      await click('Preview tanpa efek');
      await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview tanpa efek") && document.querySelector("video")?.readyState>=2', 90000);
      log('worker crash during FFmpeg, partial cleanup, successful render retry', true);
      await read('void (window.confirm = () => false)');
      await click('Proyek baru');
      need(await read('document.querySelectorAll(".timeline-clip").length===1'), 'Declining New Project lost the current edit.');
      await read('void (window.confirm = () => true)');
      await click('Proyek baru');
      await wait('document.querySelectorAll(".media-card, .timeline-clip").length===0');
      need(verified('profile/autosave/' + verified('relative.vmsproj.json').project_id + '.vmsproj.json').music.offset_us === 125000,
        'New Project changed the previous autosave.');
      log('new project cancel and confirmation preserve previous project', true);
      log('finished', true);
      return;
    }
    if (restartCheck || afterCrash) {
      const first = verified('saved.vmsproj.json');
      const saved = verified('profile/autosave/' + first.project_id + '.vmsproj.json');
      if (afterCrash) need(saved.music.offset_us === 125000 && saved.sources[0].path.endsWith('Rekaman – relatif.mp4'), 'Recovered the wrong autosave.');
      else need(saved.timeline[0].time_remap.some(segment => segment.direction === 'reverse'), 'Resume fixture lacks reverse.');
      await click('Pulihkan autosave');
      await wait('document.querySelector(".toast")?.textContent.includes("Autosave dipulihkan") && document.querySelector("video")?.readyState>=2', 60000);
      need(await read('document.querySelectorAll(".timeline-clip").length===1'), 'New desktop process did not restore the timeline.');
      log('restored playable project in a new desktop process', true);
      if (afterCrash) {
        await read('document.querySelector(".music-panel .check-row input")?.click()');
        await click('Preview tanpa efek');
        await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview tanpa efek") && document.querySelector("video")?.readyState>=2', 90000);
        log('render succeeded after desktop interruption', true);
      }
      log('finished', true);
      return;
    }
    try {
      const startupImage = await wc.capturePage(undefined, { stayHidden: true });
      if (!startupImage.isEmpty()) writeFileSync(at('startup.png'), startupImage.toPNG());
    } catch (error) { log('startup screenshot unavailable', String(error)); }
    if (nativeProject) {
      await click('Buka proyek');
      await click(nativeExport ? 'Ekspor video ↗' : 'Preview draft dengan efek');
      await wait('document.querySelector("dialog:modal")?.querySelectorAll("input").length===2');
      await read('document.querySelectorAll("dialog input").forEach(input => input.click())');
      await click(nativeExport ? 'Pilih lokasi dan ekspor' : 'Buat preview draft');
      await wait('!!document.querySelector(".render-dock")');
      await wait('!!document.querySelector(".qa-dock") || !!document.querySelector(".toast.error")', 900000);
      need(await read('!!document.querySelector(".qa-dock") && !document.querySelector(".qa-status.fail")'),
        await read('document.querySelector(".toast")?.textContent || document.querySelector(".qa-dock")?.textContent'));
      if (nativeExport) {
        const checked = profile('native-1080p60.mp4').streams.find(stream => stream.codec_type === 'video');
        need(checked?.width === 1920 && checked.height === 1080 && checked.r_frame_rate === '60/1', 'Native export has the wrong decoded profile.');
        log('native export from the save dialog', checked.nb_read_frames);
      } else {
        await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview dengan efek") && document.querySelector("video")?.readyState>=2');
        log('native preview rendered and played in the editor', await read('document.querySelector(".qa-dock").textContent'));
      }
      log('finished', true);
      return;
    }
    await click('＋ Impor rekaman');
    for (let i = 0; i < 40 && importCount === 0; i++) await new Promise(resolve => setTimeout(resolve, 100));
    need(importCount === 1, 'Cancel import did not reach the file chooser.');
    need(await read('document.querySelectorAll(".media-card").length===0'), 'Cancelled import added media');
    await click('＋ Impor rekaman');
    for (let i = 0; i < 40 && importCount === 1; i++) await new Promise(resolve => setTimeout(resolve, 100));
    need(importCount === 2, 'Second import did not reach the file chooser.');
    await wait('document.querySelector("video")?.readyState>=2', 60000);
    need(await read('document.querySelectorAll(".media-card").length===1'), 'Duplicate paths created duplicate media');
    log('cancel import, real media, duplicate import and playable proxy', true);

    await click('Tambah musik');
    await wait('document.querySelector(".music-panel .waveform")?.children.length>0', 90000);
    await click('Tandai kill manual');
    for (const [index, value] of ['24.03','24.20','24.64'].entries()) await edit('.time-inputs label:nth-child('+(index+1)+') input', value);
    await click('Simpan highlight');
    await click('Masukkan ke montage');
    await click('Apply post-kill speed ramp');
    await read('document.querySelector(".reverse-toggle input").click()');
    await edit('.trim-controls label:first-child input', '24.09');
    await click('Simpan proyek');
    await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
    const first = verified('saved.vmsproj.json');
    need(/^[a-f0-9]{64}$/.test(first.music.file_sha256), 'New music import lacks its content fingerprint.');
    need(first.timeline[0].in_us === 24090000, 'Trim did not update');
    need(first.timeline[0].time_remap.some(s=>s.direction === 'reverse'), 'Trim dropped reverse');
    need(first.timeline[0].time_remap.some(s=>s.direction === 'forward' && s.speed_num < s.speed_den), 'Trim dropped forward slow motion');
    log('trim preserves changed ramp and reverse', first.timeline[0].time_remap.map(s=>[s.speed_num,s.speed_den,s.direction]));
    await dismissNotice();
    await click('Simpan sebagai');
    await wait('document.querySelector(".toast")?.textContent.includes("JSON tersimpan")');
    need(existsSync(at('copy – audit.vmsproj.json')), 'Save As did not write its own project');
    need(verified('saved.vmsproj.json').timeline[0].in_us===24090000, 'Save As altered original');
    const portable=structuredClone(first);
    portable.sources[0].proxy_path = at('deliberately-missing-proxy.mp4');
    writeFileSync(at('missing-proxy.vmsproj.json'), JSON.stringify(portable));
    await dismissNotice();
    await click('Buka proyek');
    await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka") && document.querySelector("video")?.readyState>=2', 60000);
    log('Save As Unicode path, reload and proxy regeneration', true);

    writeFileSync(at('bad.vmsproj.json'), '{broken');
    await dismissNotice();
    await click('Buka proyek');
    await wait('!!document.querySelector(".toast.error")');
    need(await read('document.querySelectorAll(".timeline-clip").length===1'), 'Invalid project erased current timeline');
    log('invalid JSON recovery', true);
    const missing=structuredClone(portable); missing.sources[0].path=at('deliberately-missing-source.mp4');
    writeFileSync(at('missing-media.vmsproj.json'), JSON.stringify(missing));
    await dismissNotice();
    await click('Buka proyek');
    await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka")');
    await click('Ekspor video ↗');
    await wait('!!document.querySelector("dialog:modal")');
    await read('document.querySelector("dialog input").click()');
    await click('Pilih lokasi dan ekspor');
    await wait('document.querySelector(".toast.error")?.textContent.includes("tidak ditemukan")');
    log('missing source rejected by export', true);

    await click('Temukan file asli');
    await wait('!!document.querySelector(".missing-recording button:not(:disabled)")');
    await click('Temukan file asli');
    await wait('document.querySelector("video")?.readyState>=2 && !document.querySelector(".missing-recording")', 60000);
    need(await read('document.querySelectorAll(".timeline-clip").length===1'), 'Relink erased the timeline');
    need(verified('missing-media.vmsproj.json').sources[0].path === missing.sources[0].path, 'Relink rewrote the original project');
    await wait('document.querySelector(".project-name small")?.textContent === "Tersimpan otomatis"');
    const autosave = 'profile/autosave/' + first.project_id + '.vmsproj.json';
    need(verified(autosave).sources[0].path === first.sources[0].path, 'Autosave did not keep the relinked path');
    need(JSON.stringify(verified(autosave).timeline[0].time_remap) === JSON.stringify(first.timeline[0].time_remap), 'Relink changed time remapping');
    wc.reload();
    await wait('document.querySelectorAll(".media-card").length===0');
    await click('Pulihkan autosave');
    await wait('document.querySelector(".toast")?.textContent.includes("Autosave dipulihkan") && document.querySelector("video")?.readyState>=2', 60000);
    need(await read('document.querySelectorAll(".timeline-clip").length===1'), 'Recovery did not restore the timeline');
    log('missing media relink, source unchanged, and autosave restored after window reload', true);

    await dismissNotice();
    await click('Buka proyek');
    await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka") && document.querySelector("video")?.readyState>=2');
    const range = '.slider-control input[type="range"]';
    await edit(range, '0');
    await read('document.querySelector(".music-panel .check-row input").click()');
    await click('Buka Director');
    await wait('!document.querySelector(".rule-button")?.disabled && !!document.querySelector(".rule-button")');
    await read('document.querySelector(".rule-button").click()');
    await wait('!!document.querySelector(".proposal-card")');
    await click('Accept draft');
    await wait('document.querySelectorAll(".timeline-clip").length===1');
    await click('PENGATURAN');
    await click('Ekspor video ↗');
    await wait('!!document.querySelector("dialog:modal")');
    if (!(await read('document.querySelector("dialog input").checked'))) await read('document.querySelector("dialog input").click()');
    await click('Pilih lokasi dan ekspor');
    await wait('document.querySelector(".qa-dock") && !document.querySelector(".render-dock") || document.querySelector(".toast.error") ? true : false', 240000);
    need(existsSync(at('master-2.mp4')), 'Master output absent');
    const decoded=profile('master-2.mp4');
    const video=decoded.streams.find(s=>s.codec_type==='video');
    need(video.width===2560 && video.height===1440 && video.avg_frame_rate==='144/1' && Number(video.nb_read_frames)>0, 'Master output profile mismatch');
    log('master decoded profile', { width: video.width, height: video.height, fps: video.avg_frame_rate, decoded: video.nb_read_frames });
    log('master QA', verified('master-2.qa.json').status);
    await dismissNotice();
    await click('Preview tanpa efek');
    await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview tanpa efek") && document.querySelector("video")?.readyState>=2', 120000);
    log('rough preview decoded for rule draft', true);
    await dismissNotice();
    await click('Preview dengan efek');
    await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview dengan efek") && document.querySelector("video")?.readyState>=2', 120000);
    log('effects preview decoded for rule draft', true);
    await dismissNotice();
    await click('Buka proyek');
    await wait('document.querySelector(".toast")?.textContent.includes("berhasil dibuka") && document.querySelector("video")?.readyState>=2');
    await edit(range, '0');
    await read('document.querySelector(".music-panel .check-row input").click()');
    await click('Preview tanpa efek');
    await wait('document.querySelector(".stage-topline")?.textContent.includes("Preview tanpa efek") || !!document.querySelector(".toast.error")', 90000);
    need(await read('document.querySelector(".stage-topline")?.textContent.includes("Preview tanpa efek")'), 'Edited clip preview failed');
    await wait('document.querySelector("video")?.readyState>=2');
    log('rough preview decoded for edited reverse', true);
    log('finished', true);
  } catch (error) {
    log('failed', error.stack);
    log('last notification', await read('document.querySelector(".toast")?.innerText'));
  } finally {
    win.close();
  }
}
