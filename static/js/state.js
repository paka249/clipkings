'use strict';

// ── Clip Studio state ─────────────────────────────────────────
const S = {
  clips: [],
  template: 'center_crop',
  bgTemplate: '',
  mute: false,
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
  primaryDuration: 0,
  edSourceMode: 'url',
  edUploadId: null,
  edUploadName: null,
  bgSourceMode: 'url',
  bgUploadId: null,
  bgUploadName: null,
};

// ── Navigation constants ──────────────────────────────────────
const _VALID_PAGES = new Set(['dashboard','templates','splitscreen','editor','clipstudio','exports','account','upgrade','ranking','aistudio','docs']);
const _TOOL_PAGES  = new Set(['editor','clipstudio','templates','splitscreen','ranking','aistudio','exports']);
const _TOOL_NAMES  = { editor:'Video Editor', clipstudio:'Clip Studio', templates:'Templates', ranking:'Ranking', aistudio:'AI Studio', exports:'Exports' };
const _TOOL_ICONS  = { editor:'#i-film', clipstudio:'#i-edit', templates:'#i-tmpl', ranking:'#i-ranking', aistudio:'#i-aistudio', exports:'#i-folder' };

const TMPL_DESC = {
  center_crop: `
    <strong>Vertical Center-Crop</strong><br>
    · Stitches primary clips back-to-back<br>
    · Center-crops to 1080×1920 canvas<br>
    · Audio from primary track<br>
    · <em>No background video required</em>`,
  split_screen: `
    <strong>Split-Screen Vertical Stack</strong><br>
    · TOP half: your primary clips (audio on)<br>
    · BOT half: background loop (always muted)<br>
    · <em>Provide a background URL — or use a Gaming Template from the Templates page</em>`,
};

// ── Exports page state ────────────────────────────────────────
let _selectedExports = new Set();
let _allExports = [];

// ── App modal state ───────────────────────────────────────────
let _sfmOk = null;

// ── Ranking state ─────────────────────────────────────────────
const RK_DEFAULT_COLORS = [
  '#FFFFFF','#44FF88','#FFD700','#FF8C00','#4488FF',
  '#FF44FF','#00FFFF','#FF4444','#AAFF44','#FF44AA',
  '#AA88FF','#44FFCC',
];

const RKS = {
  items: [],
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
};

// ── AI Studio state ───────────────────────────────────────────
const AIS = {
  sourceType: 'url',
  uploadId: '',
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
};

// ── Video Editor state ────────────────────────────────────────
const VED = {
  library:       [],
  sequence:      [],
  photoClips:    [],
  audioClips:    [],
  selectedClip:  null,
  selectedTrack: 'video',
  seqPlaying:    false,
  seqIdx:        0,
  audioIdx:      0,
  dragUid:       null,
  dragTrack:     null,
  jobId:         null,
  pollTimer:     null,
  lastOutput:    null,
  _lastLogCount: 0,
  zoom:          1,
  captions:      [],
  imgPlayOffset: 0,
  imgPlayT0:     0,
  imgRafId:      null,
};

// ── Dashboard state ───────────────────────────────────────────
const DASH = {
  template: null,
  primaryUploadId: null,
  primaryUrl: '',
  bgTemplate: '',
  clips: [],
  rkItems: [],
  jobId: null,
};

const _TMPL_NAMES = { cs: 'Clip Studio', split: 'Splitscreen', ai: 'AI Studio', rk: 'Ranking' };

const DCS = { clips: [], uploadId: null, primaryUrl: '' };
