'use strict';

const _VED_UNDO     = [];
const _VED_REDO     = [];
const _VED_MAX_UNDO = 50;

function _vedSnapshot() {
  _VED_REDO.length = 0;
  _VED_UNDO.push({
    sequence:      JSON.parse(JSON.stringify(VED.sequence)),
    photoClips:    JSON.parse(JSON.stringify(VED.photoClips)),
    audioClips:    JSON.parse(JSON.stringify(VED.audioClips)),
    captions:      JSON.parse(JSON.stringify(VED.captions)),
    selectedClip:  VED.selectedClip,
    selectedTrack: VED.selectedTrack,
  });
  if (_VED_UNDO.length > _VED_MAX_UNDO) _VED_UNDO.shift();
}

function _vedRestoreSnap(snap) {
  VED.sequence      = snap.sequence;
  VED.photoClips    = snap.photoClips;
  VED.audioClips    = snap.audioClips;
  VED.captions      = snap.captions;
  VED.selectedClip  = snap.selectedClip;
  VED.selectedTrack = snap.selectedTrack;
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  vedRenderCaptionTrack();
  vedRenderInspector();
  _vedUpdateImgOverlays(_vedSeqElapsed());
  _vedUpdateCaptionOverlays(_vedSeqElapsed());
  _vedRenderRuler();
  _vedUpdateSeekbar();
}

function vedUndo() {
  if (!_VED_UNDO.length) return;
  _VED_REDO.push({
    sequence:      JSON.parse(JSON.stringify(VED.sequence)),
    photoClips:    JSON.parse(JSON.stringify(VED.photoClips)),
    audioClips:    JSON.parse(JSON.stringify(VED.audioClips)),
    captions:      JSON.parse(JSON.stringify(VED.captions)),
    selectedClip:  VED.selectedClip,
    selectedTrack: VED.selectedTrack,
  });
  _vedRestoreSnap(_VED_UNDO.pop());
}

function vedRedo() {
  if (!_VED_REDO.length) return;
  _VED_UNDO.push({
    sequence:      JSON.parse(JSON.stringify(VED.sequence)),
    photoClips:    JSON.parse(JSON.stringify(VED.photoClips)),
    audioClips:    JSON.parse(JSON.stringify(VED.audioClips)),
    captions:      JSON.parse(JSON.stringify(VED.captions)),
    selectedClip:  VED.selectedClip,
    selectedTrack: VED.selectedTrack,
  });
  _vedRestoreSnap(_VED_REDO.pop());
}
