/* ============================================================
   TrackCase WebApp — Icone SVG (line style, stile Material/Lucide)
   Sostituiscono le emoji: coerenti con le icone Material/Cupertino
   dell'app Flutter. Uso: Icons.get('battery', 18) oppure
   <span class="ic" data-icon="battery"></span> (auto-mount).
   ============================================================ */
(function (global) {
  'use strict';

  // path/shapes in viewBox 24x24, stroke currentColor
  const PATHS = {
    home: '<polyline points="3 10.5 12 3 21 10.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    chart: '<rect x="4.5" y="11" width="4" height="9" rx="1.3" fill="currentColor" stroke="none"/><rect x="10" y="5.5" width="4" height="14.5" rx="1.3" fill="currentColor" stroke="none"/><rect x="15.5" y="14" width="4" height="6" rx="1.3" fill="currentColor" stroke="none"/>',
    history: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    battery: '<rect x="2.5" y="8" width="16.5" height="9" rx="2"/><line x1="21.5" y1="11" x2="21.5" y2="14"/><rect x="5" y="10.5" width="7" height="4" rx="0.8" fill="currentColor" stroke="none"/>',
    'battery-charging': '<rect x="2.5" y="8" width="16.5" height="9" rx="2"/><line x1="21.5" y1="11" x2="21.5" y2="14"/><polyline points="11.5 9.5 9 12.8 12 12.8 10.5 15.5" fill="none"/>',
    cigarette: '<rect x="2" y="14" width="14" height="3.2" rx="0.6"/><rect x="17.5" y="14" width="2.5" height="3.2"/><path d="M18.5 3.5c0 1.8-1.8 2.3-1.8 4.2s1.8 2.3 1.8 4.2"/><path d="M21.5 3.5c0 1.8-1.8 2.3-1.8 4.2s1.8 2.3 1.8 4.2"/>',
    bolt: '<polyline points="13 2 6 13.2 11 13.2 10 22 18 10 13 10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    cloud: '<path d="M7 18.5a4 4 0 0 1-.42-7.97A5.5 5.5 0 0 1 17.3 8.9 3.8 3.8 0 0 1 18 18.5z"/>',
    flame: '<path d="M12 22a6 6 0 0 0 6-6c0-4-3-6-3-9-2 1-3 3-3 5-1-1-1.5-2.2-1.5-4C8 10 6 12.5 6 16a6 6 0 0 0 6 6z"/>',
    euro: '<path d="M16.8 6.3A7 7 0 1 0 16.8 17.7"/><line x1="4.5" y1="10.5" x2="13" y2="10.5"/><line x1="4.5" y1="13.5" x2="13" y2="13.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-3.8 4-5.5 7.5-5.5s6.7 1.7 7.5 5.5"/>',
    link: '<rect x="3" y="9.2" width="7.5" height="5.6" rx="2.8"/><rect x="13.5" y="9.2" width="7.5" height="5.6" rx="2.8"/><line x1="9.5" y1="12" x2="14.5" y2="12"/>',
    'link-off': '<rect x="3" y="9.2" width="7.5" height="5.6" rx="2.8"/><rect x="13.5" y="9.2" width="7.5" height="5.6" rx="2.8"/><line x1="9.5" y1="12" x2="14.5" y2="12"/><line x1="4" y1="4" x2="20" y2="20"/>',
    trash: '<polyline points="4 7 20 7"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 14h9l1-14"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><polyline points="20 3.5 20 8 15.5 8"/>',
    check: '<polyline points="5 12.5 10 17.5 19 7"/>',
    minus: '<line x1="6" y1="12" x2="18" y2="12"/>',
    plus: '<line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/>',
    'chevron-right': '<polyline points="9 5 16 12 9 19"/>',
    'chevron-left': '<polyline points="15 5 8 12 15 19"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    device: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>',
    case: '<rect x="4.5" y="3.5" width="15" height="17" rx="3"/><line x1="12" y1="3.5" x2="12" y2="20.5" opacity="0.35"/>'
  };

  function get(name, size) {
    const s = size || 20;
    const body = PATHS[name] || PATHS.device;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // Sostituisce automaticamente <span class="ic" data-icon="nome" data-size="18">
  function mount(root) {
    (root || document).querySelectorAll('.ic[data-icon]').forEach(el => {
      el.innerHTML = get(el.dataset.icon, parseInt(el.dataset.size || '0', 10) || undefined);
    });
  }

  global.Icons = { get, mount };
})(window);
