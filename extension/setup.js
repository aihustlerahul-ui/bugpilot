// extension/setup.js
'use strict';

const micCard         = document.getElementById('mic-card');
const micCardStatus   = document.getElementById('mic-card-status');
const micTestArea     = document.getElementById('mic-test-area');
const micLevelMeter    = document.getElementById('mic-level-meter');
const micLevelBars     = [0,1,2,3,4,5,6,7].map(i => document.getElementById(`mic-level-bar-${i}`));
const micTestAreaIcon  = document.getElementById('mic-test-area-icon');
const micConfirm       = document.getElementById('mic-confirm');
const micDeviceSelect  = document.getElementById('mic-device-select');
const micTestBtn       = document.getElementById('mic-test-btn');

const camCard         = document.getElementById('cam-card');
const camCardStatus   = document.getElementById('cam-card-status');
const camTestArea     = document.getElementById('cam-test-area');
const camPreview       = document.getElementById('cam-preview');
const camTestAreaIcon  = document.getElementById('cam-test-area-icon');
const camConfirm       = document.getElementById('cam-confirm');
const camDeviceSelect  = document.getElementById('cam-device-select');
const camTestBtn       = document.getElementById('cam-test-btn');

const completionBanner = document.getElementById('completion-banner');

let micReady = false;
let camReady = false;
let micStream = null;
let camStream = null;
let micAudioCtx = null;
let micRafId = null;
// Incremented on every runMicTest()/runCamTest() call so an in-flight getUserMedia() from a
// superseded call (e.g. two quick device-select changes) can detect it's stale after the
// await and tear down its own stream instead of overwriting/orphaning the current one.
let micTestGen = 0;
let camTestGen = 0;

async function init() {
  const { qa_ext_settings } = await chrome.storage.local.get(['qa_ext_settings']);
  const settings = qa_ext_settings || {};
  if (settings.captureAudioEnabled) {
    micCard.style.display = '';
    await populateDeviceList(micDeviceSelect, 'audioinput');
  }
  if (settings.captureWebcamEnabled) {
    camCard.style.display = '';
    await populateDeviceList(camDeviceSelect, 'videoinput');
  }
  if (!settings.captureAudioEnabled && !settings.captureWebcamEnabled) {
    document.querySelector('.page-subtitle').textContent =
      'Neither microphone nor camera capture is enabled in your workspace settings.';
  }
}

async function populateDeviceList(selectEl, kind) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const filtered = devices.filter(d => d.kind === kind);
    selectEl.innerHTML = '';
    if (filtered.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'System default';
      selectEl.appendChild(opt);
      return;
    }
    filtered.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}`;
      selectEl.appendChild(opt);
    });
  } catch (_) {
    selectEl.innerHTML = '<option value="">System default</option>';
  }
}

init();

function setMicState(status) {
  micCardStatus.textContent = status === 'ready' ? 'Ready' : status === 'blocked' ? 'Blocked' : 'Not started';
  micCardStatus.className = 'card-status' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
  micCard.className = 'card' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
}

function showMicConfirm(status, message) {
  micConfirm.textContent = message;
  micConfirm.className = 'confirm-box show ' + status;
}

function stopMicTest() {
  if (micRafId) cancelAnimationFrame(micRafId);
  if (micAudioCtx) { micAudioCtx.close().catch(() => {}); micAudioCtx = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  micLevelMeter.style.display = 'none';
  micTestAreaIcon.style.display = '';
}

async function runMicTest() {
  stopMicTest();
  const deviceId = micDeviceSelect.value;
  const myGen = ++micTestGen;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (err) {
    if (myGen !== micTestGen) return; // superseded by a newer call while awaiting
    setMicState('blocked');
    showMicConfirm('blocked', 'Could not access the microphone — check Chrome and OS permission settings.');
    return;
  }
  if (myGen !== micTestGen) {
    // A newer runMicTest() started while this one was awaiting getUserMedia — this stream
    // lost the race, stop it immediately so its device LED doesn't stay lit.
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  micStream = stream;

  micReady = true;
  setMicState('ready');
  showMicConfirm('ready', 'Bars moving means it\'s picking up sound.');
  micTestAreaIcon.style.display = 'none';
  micLevelMeter.style.display = '';
  micTestBtn.textContent = 'Retest microphone';
  micTestBtn.classList.add('retest');
  await populateDeviceList(micDeviceSelect, 'audioinput');
  if (myGen !== micTestGen) return; // superseded while populating the device list

  micAudioCtx = new AudioContext();
  const source = micAudioCtx.createMediaStreamSource(micStream);
  const analyser = micAudioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const barCount = micLevelBars.length;

  function tick() {
    if (myGen !== micTestGen || !micStream) return;
    analyser.getByteFrequencyData(data);
    const chunk = Math.floor(data.length / barCount);
    for (let i = 0; i < barCount; i++) {
      const slice = data.slice(i * chunk, (i + 1) * chunk);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      micLevelBars[i].style.height = `${Math.max(8, Math.min(100, (avg / 255) * 100 * 2))}%`;
    }
    micRafId = requestAnimationFrame(tick);
  }
  tick();

  checkCompletion();
}

micTestBtn.addEventListener('click', runMicTest);
micDeviceSelect.addEventListener('change', () => { if (micReady) runMicTest(); });

function setCamState(status) {
  camCardStatus.textContent = status === 'ready' ? 'Ready' : status === 'blocked' ? 'Blocked' : 'Not started';
  camCardStatus.className = 'card-status' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
  camCard.className = 'card' + (status === 'ready' ? ' ready' : status === 'blocked' ? ' blocked' : '');
}

function showCamConfirm(status, message) {
  camConfirm.textContent = message;
  camConfirm.className = 'confirm-box show ' + status;
}

function stopCamTest() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  camPreview.srcObject = null;
  camPreview.style.display = 'none';
  camTestAreaIcon.style.display = '';
}

async function runCamTest() {
  stopCamTest();
  const deviceId = camDeviceSelect.value;
  const myGen = ++camTestGen;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch (err) {
    if (myGen !== camTestGen) return; // superseded by a newer call while awaiting
    setCamState('blocked');
    showCamConfirm('blocked', 'Could not access the camera — check Chrome and OS permission settings.');
    return;
  }
  if (myGen !== camTestGen) {
    // A newer runCamTest() started while this one was awaiting getUserMedia — this stream
    // lost the race, stop it immediately so its device LED doesn't stay lit.
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  camStream = stream;

  camReady = true;
  setCamState('ready');
  showCamConfirm('ready', 'You can see yourself above — camera is working.');
  camTestAreaIcon.style.display = 'none';
  camPreview.srcObject = camStream;
  camPreview.style.display = '';
  camTestBtn.textContent = 'Retest camera';
  camTestBtn.classList.add('retest');
  await populateDeviceList(camDeviceSelect, 'videoinput');
  if (myGen !== camTestGen) return; // superseded while populating the device list

  checkCompletion();
}

camTestBtn.addEventListener('click', runCamTest);
camDeviceSelect.addEventListener('change', () => { if (camReady) runCamTest(); });

function checkCompletion() {
  const micCardVisible = micCard.style.display !== 'none';
  const camCardVisible = camCard.style.display !== 'none';
  const micDone = !micCardVisible || micReady;
  const camDone = !camCardVisible || camReady;
  if (micDone && camDone && (micCardVisible || camCardVisible)) {
    completionBanner.classList.add('show');
    setTimeout(() => window.close(), 1500);
  }
}
