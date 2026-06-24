'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Restore theme
  const savedBase   = localStorage.getItem('sf-theme-base')   || 'dark';
  const savedAccent = localStorage.getItem('sf-theme-accent') || '#3B82F6';
  setBase(savedBase);
  const picker = document.getElementById('accent-picker');
  if (picker) { picker.value = savedAccent; setAccent(savedAccent); }
  const profPicker = document.getElementById('profile-accent-picker');
  if (profPicker) profPicker.value = savedAccent;
  syncAccentUI(savedAccent);

  // Restore sidebar collapsed state
  if (localStorage.getItem('sf-sidebar-collapsed')) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('sidebar--collapsed');
  }

  // Init resize handles
  _initSidebarResize();
  _initTimelineResize();
  _initPropsResize();

  // Restore page from URL hash (back/forward support)
  const hashPage = location.hash.slice(1);
  const startPage = _VALID_PAGES.has(hashPage) ? hashPage : 'templates';
  history.replaceState({ page: startPage }, '', '#' + startPage);
  showPage(startPage, true);

  checkAuth().then(loadProfile);
  onTemplateChange();
  renderClips();
  checkReady();
  initTimelineSlider(0);
  vedRenderPhotoTrack();
  vedRenderAudioTrack();
  vedRenderInspector();

  // Close app modal on Escape; Backspace/Delete to remove selected timeline clip
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _sfModalClose();
    if ((e.key === 'Backspace' || e.key === 'Delete') && VED.selectedClip) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if      (VED.selectedTrack === 'audio') vedRemoveFromAudioSeq(VED.selectedClip);
      else if (VED.selectedTrack === 'photo') vedRemoveFromPhotoSeq(VED.selectedClip);
      else                                    vedRemoveFromSeq(VED.selectedClip);
    }
  });

  // Wire template card clicks for dashboard workspace
  document.querySelectorAll('.tmpl-picker-card[data-tmpl]').forEach(card => {
    card.addEventListener('click', function() {
      dashSelectTemplate(this.dataset.tmpl);
    });
  });
});
