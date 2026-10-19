(function () {
  'use strict';
  var IO = IOSim;
  var $ = function (id) { return document.getElementById(id); };
  var KEYS = ['words', 'devDelay', 'xfer', 'poll', 'intCost', 'dmaSetup', 'dmaCycle'];
  var result = null, shown = 0, timer = null;

  var COLORS = {
    useful: 'var(--good)', poll: 'var(--bad)', pollok: 'var(--bad)', transfer: 'var(--accent)', isr: 'var(--warn)',
    setup: 'var(--purple)', stalled: 'var(--muted)', prepare: 'var(--teal)', dmamove: 'var(--purple)'
  };
  var NAMES = {
    useful: 'CPU doing useful work', poll: 'CPU busy-waiting (wasted)', pollok: 'CPU poll that found data ready', transfer: 'CPU moving a word',
    isr: 'interrupt overhead', setup: 'DMA setup by CPU', stalled: 'CPU stalled, DMA owns the bus', prepare: 'device preparing a word', dmamove: 'DMA moving a word'
  };

  function readParams() {
    var p = {};
    KEYS.forEach(function (k) { p[k] = Number($(k).value); });
    return p;
  }
  function fillParams(p) { KEYS.forEach(function (k) { $(k).value = p[k]; }); }
  function stop() { if (timer) { clearInterval(timer); timer = null; $('btnPlay').textContent = 'Play'; } }

  function recalc() {
    stop();
    var p = readParams(), msgs = IO.validate(p);
    $('err').textContent = msgs.join('\n');
    if (msgs.length) return;
    result = IO.simulate($('method').value, p);
    shown = 0;
    $('now').innerHTML = '<span class="muted">Press <b>Next event</b> to start the transfer.</span>';
    renderAll();
  }

  /* ---------------------------------------------------------- timeline */
  function renderTimeline() {
    var lanes = ['cpu', 'dev'].concat(result.method === 'dma' ? ['dma'] : []);
    var laneName = { cpu: 'CPU', dev: 'Device', dma: 'DMA ctrl' };
    var W = 1000, left = 70, right = 12, laneH = 34, gap = 14, top = 14;
    var H = top + lanes.length * (laneH + gap) + 30;
    var span = W - left - right, total = result.total;
    function X(t) { return left + t / total * span; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="timeline of CPU, device and DMA activity">';
    lanes.forEach(function (l, i) {
      var y = top + i * (laneH + gap);
      s += '<text x="6" y="' + (y + laneH / 2 + 4) + '" font-size="13" font-weight="650" fill="var(--ink)">' + laneName[l] + '</text>';
      s += '<rect x="' + left + '" y="' + y + '" width="' + span + '" height="' + laneH + '" fill="var(--bg)" stroke="var(--line)" rx="4"/>';
    });
    result.segments.forEach(function (g, idx) {
      var y = top + lanes.indexOf(g.lane) * (laneH + gap);
      var x = X(g.start), w = Math.max(1.5, X(g.end) - X(g.start));
      var on = idx < shown, cur = idx === shown - 1;
      s += '<g><title>' + g.label + ' (cycles ' + g.start + ' to ' + g.end + ')</title><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + laneH + '" rx="3" fill="' + COLORS[g.state] + '" opacity="' + (on ? 1 : 0.13) + '"' +
        (cur ? ' stroke="var(--ink)" stroke-width="2.5"' : '') + '/>';
      if (on && w > g.label.length * 6.4 + 10) s += '<text x="' + (x + w / 2) + '" y="' + (y + laneH / 2 + 4) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#fff" style="pointer-events:none">' + g.label + '</text>';
      s += '</g>';
    });
    // axis
    var axisY = top + lanes.length * (laneH + gap) - 4;
    var step = niceStep(total / 8);
    for (var t = 0; t <= total; t += step) {
      s += '<line x1="' + X(t) + '" y1="' + axisY + '" x2="' + X(t) + '" y2="' + (axisY + 5) + '" stroke="var(--muted)"/><text x="' + X(t) + '" y="' + (axisY + 18) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + t + '</text>';
    }
    if (shown > 0) {
      var c = result.segments[shown - 1];
      s += '<line x1="' + X(c.start) + '" y1="' + (top - 6) + '" x2="' + X(c.start) + '" y2="' + axisY + '" stroke="var(--ink)" stroke-dasharray="4 3"/>';
    }
    s += '</svg>';
    $('timeline').innerHTML = s;
    var used = {};
    result.segments.forEach(function (g) { used[g.state] = true; });
    $('legend').innerHTML = Object.keys(NAMES).filter(function (k) { return used[k]; }).map(function (k) {
      return '<span><i style="background:' + COLORS[k] + '"></i>' + NAMES[k] + '</span>';
    }).join('');
  }
  function niceStep(raw) {
    var m = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    for (var i = 0; i < m.length; i++) if (m[i] >= raw) return m[i];
    return 10000;
  }

  /* ---------------------------------------------------------- diagram */
  var BOX = { CPU: [20, 25, 110, 56], MEM: [320, 25, 110, 56], DEV: [320, 165, 110, 56], DMA: [170, 165, 110, 56] };
  var FULL = { CPU: 'CPU', MEM: 'Main memory', DEV: 'I/O device', DMA: 'DMA controller' };
  function buildDiagram() {
    var s = '<svg viewBox="0 0 480 250" width="100%" role="img" aria-label="CPU, memory, device and DMA controller on a shared bus">';
    s += '<rect x="10" y="108" width="440" height="14" rx="7" fill="var(--line)"/><text x="230" y="119" text-anchor="middle" font-size="10.5" fill="var(--muted)">system bus</text>';
    [['CPU', 75], ['MEM', 375], ['DEV', 375], ['DMA', 225]].forEach(function (a) {
      var b = BOX[a[0]], up = b[1] < 108;
      s += '<line x1="' + a[1] + '" y1="' + (up ? b[1] + b[3] : 122) + '" x2="' + a[1] + '" y2="' + (up ? 108 : b[1]) + '" stroke="var(--muted)" stroke-width="2"/>';
    });
    s += '<path d="M130 53 H150 V193 H170" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="4 3"/><text x="154" y="140" font-size="9.5" fill="var(--muted)" transform="rotate(-90 154 140)">setup</text>';
    s += '<path d="M430 205 H452 V70 H432" fill="none" stroke="var(--warn)" stroke-width="1.4" stroke-dasharray="4 3"/>';
    s += '<text x="468" y="150" font-size="9.5" fill="var(--muted)" transform="rotate(-90 468 150)">interrupt line</text>';
    Object.keys(BOX).forEach(function (id) {
      var b = BOX[id];
      s += '<g id="d-' + id + '"><rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" rx="8" fill="var(--panel)" stroke="var(--line)" stroke-width="1.8"/><text x="' + (b[0] + b[2] / 2) + '" y="' + (b[1] + b[3] / 2 + 4) + '" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">' + FULL[id] + '</text></g>';
    });
    s += '</svg>';
    $('diagram').innerHTML = s;
  }
  var ACTIVE = {
    useful: ['CPU'], poll: ['CPU', 'DEV'], pollok: ['CPU', 'DEV'], transfer: ['CPU', 'DEV', 'MEM'], isr: ['CPU', 'DEV'],
    setup: ['CPU', 'DMA'], stalled: ['DMA'], prepare: ['DEV'], dmamove: ['DMA', 'DEV', 'MEM']
  };
  function paintDiagram() {
    var on = {};
    if (shown > 0) {
      var t = result.segments[shown - 1].start;
      result.segments.forEach(function (g, i) {
        if (i < shown && g.start <= t && t < g.end) (ACTIVE[g.state] || []).forEach(function (n) { on[n] = true; });
      });
    }
    $('d-DMA').style.opacity = result.method === 'dma' ? 1 : 0.3;
    Object.keys(BOX).forEach(function (id) {
      var r = $('d-' + id).querySelector('rect');
      r.setAttribute('stroke', on[id] ? 'var(--accent)' : 'var(--line)');
      r.setAttribute('fill', on[id] ? 'var(--accent-soft)' : 'var(--panel)');
      r.setAttribute('stroke-width', on[id] ? '3' : '1.8');
    });
    $('diagNote').textContent = shown ? '- active now: ' + Object.keys(on).map(function (k) { return FULL[k]; }).join(', ') : '';
  }

  /* ---------------------------------------------------------- stats */
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function renderStats() {
    var s = result.stats;
    function st(v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
    $('stats').innerHTML = st(s.total, 'total cycles') + st(s.useful, 'CPU useful cycles') + st(pct(s.utilisation), 'CPU useful share') +
      st(s.busyWait, 'cycles busy-waiting') + st(s.cpuTransfer, 'cycles moving data') + st(s.interruptOverhead + s.setup, 'interrupt + setup cycles') +
      st(s.stalled, 'cycles stalled by DMA') + st(s.interrupts, 'interrupts taken') + st((s.throughput * 100).toFixed(2), 'words per 100 cycles');
  }
  function renderCompare() {
    var all = IO.compareAll(readParams());
    var rows = [
      ['Total cycles', function (s) { return s.total; }, 'min'],
      ['CPU useful cycles', function (s) { return s.useful; }, 'max'],
      ['CPU useful share', function (s) { return s.utilisation; }, 'max', pct],
      ['CPU busy-waiting', function (s) { return s.busyWait; }, 'min'],
      ['CPU moving data', function (s) { return s.cpuTransfer; }, 'min'],
      ['Interrupt + setup overhead', function (s) { return s.interruptOverhead + s.setup; }, 'none'],
      ['CPU stalled by DMA', function (s) { return s.stalled; }, 'none'],
      ['Interrupts taken', function (s) { return s.interrupts; }, 'min']
    ];
    var h = '<tr><th>Measure</th>' + all.map(function (r) { return '<th class="num">' + r.name.replace(' (polling)', '').replace(' (DMA)', '') + '</th>'; }).join('') + '</tr>';
    rows.forEach(function (row) {
      var vals = all.map(function (r) { return row[1](r.stats); });
      var best = row[2] === 'min' ? Math.min.apply(null, vals) : row[2] === 'max' ? Math.max.apply(null, vals) : null;
      h += '<tr><td>' + row[0] + '</td>' + vals.map(function (v) {
        return '<td class="num' + (best !== null && v === best ? ' best' : '') + '">' + (row[3] ? row[3](v) : v) + '</td>';
      }).join('') + '</tr>';
    });
    h += '<tr><td>CPU useful share</td>' + all.map(function (r) {
      return '<td><div class="bar"><i style="width:' + r.stats.utilisation * 100 + '%"></i></div></td>';
    }).join('') + '</tr>';
    $('cmp').innerHTML = h;
  }

  /* ---------------------------------------------------------- log + step */
  function renderLog() {
    var h = '';
    for (var i = 0; i < shown; i++) {
      var g = result.segments[i];
      h += '<div' + (i === shown - 1 ? ' class="cur"' : '') + '><b>cycle ' + g.start + '-' + g.end + '</b> [' + g.lane.toUpperCase() + '] ' + g.label + '</div>';
    }
    $('log').innerHTML = h || '<span class="muted">Nothing yet.</span>';
    $('log').scrollTop = $('log').scrollHeight;
  }
  function renderNow() {
    if (!shown) return;
    var g = result.segments[shown - 1];
    $('now').innerHTML = '<span class="pill info">cycle ' + g.start + ' &rarr; ' + g.end + '</span> <span class="pill purple">' + { cpu: 'CPU', dev: 'Device', dma: 'DMA controller' }[g.lane] + '</span>' +
      '<div style="margin-top:8px;font-size:14.5px"><b>' + g.label + '</b><br>' + g.text + '</div>';
    $('progress').textContent = 'Event ' + shown + ' of ' + result.segments.length + (shown === result.segments.length ? ' - transfer complete at cycle ' + result.total + '.' : '');
  }
  function renderAll() {
    renderTimeline(); paintDiagram(); renderStats(); renderCompare(); renderLog(); renderNow();
    var done = shown >= result.segments.length;
    $('btnStep').disabled = done; $('btnAll').disabled = done; $('btnPlay').disabled = done && !timer;
    if (!shown) $('progress').textContent = result.segments.length + ' events in this run.';
  }
  function next() {
    if (!result || shown >= result.segments.length) { stop(); return; }
    shown++; renderAll();
    if (shown >= result.segments.length) stop();
  }

  function init() {
    buildDiagram();
    fillParams(IO.DEFAULTS);
    KEYS.concat(['method']).forEach(function (k) { $(k).onchange = recalc; });
    $('btnDefaults').onclick = function () { fillParams(IO.DEFAULTS); recalc(); };
    $('btnStep').onclick = function () { stop(); next(); };
    $('btnReset').onclick = recalc;
    $('btnAll').onclick = function () { stop(); shown = result.segments.length; renderAll(); };
    $('btnPlay').onclick = function () {
      if (timer) { stop(); return; }
      $('btnPlay').textContent = 'Pause';
      timer = setInterval(next, 600);
    };
    recalc();
  }
  init();
})();
