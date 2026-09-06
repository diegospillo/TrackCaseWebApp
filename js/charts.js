/* ============================================================
   TrackCase WebApp — Charts (canvas/SVG, zero dipendenze)
   Replicano i CustomPainter dell'app Flutter:
   - FitnessRing  (ui/widgets/fitness_ring_widget.dart)
   - WeeklyChart  (ui/widgets/weekly_bar_chart.dart)
   - TimelineChart(ui/widgets/daily_timeline_chart.dart)

   Regole di robustezza:
   - Altezza FISSA definita in CSS (#weeklyChart/#timelineChart):
     mai dinamica, mai ricalcolata da JS.
   - La larghezza si misura con getBoundingClientRect() e se il
     canvas non è ancora lay-out (tab nascosta) il render viene
     rimandato dal chiamante.
   ============================================================ */
(function (global) {
  'use strict';

  const COLORS = {
    electric: '#00E5FF',
    success: '#00E676',
    amber: '#FFC107',
    error: '#FF3D00',
    trackRing: 'rgba(255,255,255,0.10)',
    dimText: 'rgba(255,255,255,0.45)'
  };

  // ---------- Fitness Ring (SVG) ----------
  function renderRing(container, progress, size, strokeWidth, labelTop, labelBottom) {
    const p = Math.max(0, Math.min(progress, 2));
    const r = (size - strokeWidth) / 2;
    const cx = size / 2;
    const circumference = 2 * Math.PI * r;
    const overLimit = progress > 1;

    const gradId = 'rg' + Math.random().toString(36).slice(2, 8);
    const dash = (Math.min(p, 1)) * circumference;
    const over = p > 1 ? (p - 1) * circumference : 0;

    const circle = (offset, len, color) =>
      `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"
        stroke-linecap="round" stroke-dasharray="${len} ${circumference}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${cx} ${cx})" />`;

    const label = labelTop
      ? (size >= 100
        ? `<text x="${cx}" y="${cx - 2}" text-anchor="middle" class="ring-label-top">${labelTop}</text>
           <text x="${cx}" y="${cx + 18}" text-anchor="middle" class="ring-label-bottom">${labelBottom || ''}</text>`
        : `<text x="${cx}" y="${cx + size * 0.06}" text-anchor="middle" fill="#fff" font-weight="700" font-size="${size * 0.28}">${labelTop}</text>`)
      : '';

    container.innerHTML =
      `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${overLimit ? COLORS.amber : COLORS.electric}" />
            <stop offset="100%" stop-color="${overLimit ? COLORS.error : COLORS.success}" />
          </linearGradient>
        </defs>
        ${circle(0, circumference, COLORS.trackRing)}
        ${p > 0 ? circle(0, dash, `url(#${gradId})`) : ''}
        ${over > 0 ? circle(-circumference, over, `url(#${gradId})`) : ''}
        ${label}
      </svg>`;
  }

  // ---------- setup canvas HiDPI ----------
  // Ritorna null se il canvas non è ancora lay-out (tab nascosta):
  // il chiamante deve riprovare quando la tab diventa visibile.
  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);
    if (cssWidth <= 0 || cssHeight <= 0) return null;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;   // assegnare width resetta anche il transform
    canvas.height = cssHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    return { ctx, w: cssWidth, h: cssHeight };
  }

  function drawEmptyState(ctx, w, h) {
    ctx.fillStyle = COLORS.dimText;
    ctx.font = '600 13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nessuna sessione', w / 2, h / 2 - 8);
  }

  // ---------- Weekly Bar Chart (altezza fissa via CSS) ----------
  function renderWeeklyChart(canvas, totals, budget) {
    const env = setupCanvas(canvas);
    if (!env) return false;
    const { ctx, w, h } = env;

    totals = totals && totals.length ? totals : [0, 0, 0, 0, 0, 0, 0];
    const allZero = totals.every(t => t === 0);

    let maxCount = Math.max(budget || 1, 1);
    for (const c of totals) if (c > maxCount) maxCount = c;

    const baselineY = h - 24;
    const maxBarHeight = baselineY - 20;
    const slotWidth = w / 7;
    const barWidth = 12;

    // baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(w, baselineY);
    ctx.stroke();

    // linea budget tratteggiata
    const budgetY = baselineY - (Math.min(budget, maxCount) / maxCount) * maxBarHeight;
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, budgetY);
    ctx.lineTo(w, budgetY);
    ctx.stroke();
    ctx.setLineDash([]);

    // barre
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, COLORS.electric);
    grad.addColorStop(1, COLORS.success);
    ctx.lineCap = 'round';
    ctx.lineWidth = barWidth;

    for (let i = 0; i < 7; i++) {
      const count = totals[i] || 0;
      if (count <= 0) continue;
      let barH = (count / maxCount) * maxBarHeight;
      if (barH < barWidth) barH = barWidth;
      const x = i * slotWidth + slotWidth / 2;

      if (count > budget) {
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, baselineY);
        ctx.lineTo(x, budgetY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,61,0,0.6)';
        ctx.beginPath();
        ctx.moveTo(x, budgetY);
        ctx.lineTo(x, baselineY - barH);
        ctx.stroke();
      } else {
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, baselineY);
        ctx.lineTo(x, baselineY - barH);
        ctx.stroke();
      }
    }

    // etichette giorni
    const dayLabels = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const jsDay = d.getDay();
      ctx.fillText(dayLabels[(jsDay + 6) % 7], i * slotWidth + slotWidth / 2, baselineY + 16);
    }

    if (allZero) drawEmptyState(ctx, w, h);
    return true;
  }

  // ---------- Daily Timeline 24h (altezza fissa via CSS) ----------
  function renderTimeline(canvas, sessionsDates) {
    const env = setupCanvas(canvas);
    if (!env) return false;
    const { ctx, w, h } = env;

    const hourly = new Array(24).fill(0);
    for (const d of sessionsDates) hourly[d.getHours()]++;
    const allZero = hourly.every(c => c === 0);
    let maxCount = 1;
    for (const c of hourly) if (c > maxCount) maxCount = c;

    const baselineY = h - 20;
    const barWidth = 6;
    const slotWidth = w / 24;
    const maxBarHeight = baselineY - 10;

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(w, baselineY);
    ctx.stroke();

    ctx.strokeStyle = COLORS.error;
    ctx.lineWidth = barWidth;
    ctx.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const count = hourly[i];
      if (count <= 0) continue;
      let barH = (count / maxCount) * maxBarHeight;
      if (barH < barWidth) barH = barWidth;
      const x = i * slotWidth + slotWidth / 2;
      ctx.beginPath();
      ctx.moveTo(x, baselineY);
      ctx.lineTo(x, baselineY - barH);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (const hour of [0, 6, 12, 18]) {
      ctx.fillText(String(hour).padStart(2, '0') + ':00', hour * slotWidth + slotWidth / 2, baselineY + 14);
    }

    if (allZero) drawEmptyState(ctx, w, h);
    return true;
  }

  global.Charts = { renderRing, renderWeeklyChart, renderTimeline };
})(window);
