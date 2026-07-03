'use strict';

// ── Constants ─────────────────────────────────────────────────
const _VED_BASE_PPS          = 60;
const _VED_PHOTO_DEFAULT_DUR = 3;
const _VED_MAX_VIDEO         = 10;
const _VED_MAX_AUDIO         = 3;
const _VED_MAX_IMG           = 20;
const _VED_MAX_LIB           = 30;

const _VED_IMG_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.jfif','.avif']);
const _VED_AUD_EXTS = new Set(['.mp3','.aac','.wav','.m4a','.ogg','.flac']);

// ── Core helpers ──────────────────────────────────────────────
function _vedPPS() { return _VED_BASE_PPS * (VED.zoom || 1); }

function _vedClipDur(item) {
  return Math.max(0.05, (item.end != null ? item.end : (item.duration || 0)) - (item.start || 0));
}

function _vedUpdatePlaceholder() {
  const el = document.getElementById('ved-canvas-placeholder');
  if (!el) return;
  const hasMedia = VED.sequence.length || VED.photoClips.length ||
                   VED.audioClips.length || VED.captions.length;
  el.style.display = hasMedia ? 'none' : '';
}

function _vedApplyCanvasBg(color) {
  VED.canvasBg = color || '#111111';
  const box = document.querySelector('.ved-canvas-box');
  if (box) box.style.background = VED.canvasBg;
  const picker = document.getElementById('ved-canvas-bg-picker');
  if (picker) picker.value = VED.canvasBg;
}

// ── File type detection ───────────────────────────────────────
function _vedIsImg(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return _VED_IMG_EXTS.has(ext) || file.type.startsWith('image/');
}

function _vedIsAud(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return _VED_AUD_EXTS.has(ext) || file.type.startsWith('audio/');
}

// expectedTrack: 'image' | 'audio' | 'video' | null (auto for drag-drop)
function _vedValidateFile(file, expectedTrack) {
  const mb    = file.size / 1048576;
  const isImg = _vedIsImg(file);
  const isAud = _vedIsAud(file);

  if (expectedTrack === 'image') {
    if (!isImg)
      return `"${file.name}" is not an image. The Images track only accepts JPG, PNG, WebP, or GIF.`;
    if (mb > 10)
      return `"${file.name}" is ${mb.toFixed(1)} MB — images must be under 10 MB.`;
  } else if (expectedTrack === 'audio') {
    if (!isAud)
      return `"${file.name}" is not an audio file. The Audio track only accepts MP3, AAC, WAV, M4A, OGG, or FLAC.`;
    if (mb > 100)
      return `"${file.name}" is ${mb.toFixed(0)} MB — audio must be under 100 MB.`;
  } else if (expectedTrack === 'video') {
    if (isImg || isAud)
      return `"${file.name}" is not a video. The Video track only accepts MP4, MOV, MKV, WebM, AVI, and similar formats.`;
    if (mb > 500)
      return `"${file.name}" is ${mb.toFixed(0)} MB — videos must be under 500 MB.`;
  } else {
    if (isImg && mb > 10)  return `"${file.name}" is ${mb.toFixed(1)} MB — images must be under 10 MB.`;
    if (isAud && mb > 100) return `"${file.name}" is ${mb.toFixed(0)} MB — audio must be under 100 MB.`;
    if (!isImg && !isAud && mb > 500) return `"${file.name}" is ${mb.toFixed(0)} MB — videos must be under 500 MB.`;
  }
  return null;
}
