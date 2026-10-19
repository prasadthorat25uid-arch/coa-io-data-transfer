/*
 * io.js - core of the I/O data transfer simulator (no DOM code).
 *
 * Model: an input device hands over N words, one at a time. After a word has been
 * taken, the device needs `devDelay` cycles to prepare the next one. The simulator
 * lays out, cycle by cycle, what the CPU, the device and (for DMA) the DMA
 * controller are doing, for each of the three transfer methods.
 *
 * Parameters (all in clock cycles except words):
 *   words     number of words to move
 *   devDelay  time the device needs to prepare each word
 *   xfer      CPU time to move one word from the device register to memory
 *   poll      time for one status-register check (programmed I/O)
 *   intCost   total interrupt overhead per interrupt: entry + context save + restore + return
 *   dmaSetup  CPU time to program the DMA controller (address, count, direction)
 *   dmaCycle  bus cycles the DMA controller steals per word (the CPU is stalled meanwhile)
 */
(function (root) {
  'use strict';

  var METHODS = {
    pio: 'Programmed I/O (polling)',
    interrupt: 'Interrupt-driven I/O',
    dma: 'Direct memory access (DMA)'
  };

  function simulate(method, p) {
    var segs = [];
    function add(lane, state, start, end, label, text, word) {
      if (end <= start) return;
      segs.push({ lane: lane, state: state, start: start, end: end, label: label, text: text, word: word || null });
    }
    var t = 0, k, ready, prevFree;
    var N = p.words, D = p.devDelay;

    if (method === 'pio') {
      prevFree = 0;                       // moment the device starts preparing the next word
      for (k = 1; k <= N; k++) {
        ready = prevFree + D;
        add('dev', 'prepare', prevFree, ready, 'prepare word ' + k,
          'The device is preparing word ' + k + ' (ready at cycle ' + ready + ').', k);
        var waitStart = t, notReady = 0;
        while (t + p.poll < ready) { t += p.poll; notReady++; }
        if (notReady) {
          add('cpu', 'poll', waitStart, t, 'busy-wait (' + notReady + ' polls)',
            'CPU keeps reading the status register, ' + notReady + ' time' + (notReady > 1 ? 's' : '') + ', and each time the device says "not ready". These cycles are wasted.', k);
        }
        add('cpu', 'pollok', t, t + p.poll, 'poll: ready', 'CPU reads the status register again and finds word ' + k + ' is ready.', k);
        t += p.poll;
        add('cpu', 'transfer', t, t + p.xfer, 'move word ' + k, 'CPU copies word ' + k + ' from the device data register into memory.', k);
        t += p.xfer;
        prevFree = t;
      }
    }

    if (method === 'interrupt') {
      prevFree = 0;
      var entry = Math.ceil(p.intCost / 2), exit = p.intCost - entry;
      for (k = 1; k <= N; k++) {
        ready = prevFree + D;
        add('dev', 'prepare', prevFree, ready, 'prepare word ' + k,
          'The device is preparing word ' + k + ' (it will raise an interrupt at cycle ' + ready + ').', k);
        if (ready > t) {
          add('cpu', 'useful', t, ready, 'useful work', 'CPU runs its normal program. It is not looking at the device at all.', k);
          t = ready;
        }
        add('cpu', 'isr', t, t + entry, 'interrupt entry',
          'Device raised an interrupt for word ' + k + '. CPU finishes the current instruction, saves its context and jumps to the interrupt service routine.', k);
        t += entry;
        add('cpu', 'transfer', t, t + p.xfer, 'ISR: move word ' + k, 'Inside the service routine the CPU copies word ' + k + ' into memory.', k);
        t += p.xfer;
        prevFree = t;
        add('cpu', 'isr', t, t + exit, 'restore & return', 'CPU restores its registers and returns to the interrupted program.', k);
        t += exit;
      }
    }

    if (method === 'dma') {
      add('cpu', 'setup', 0, p.dmaSetup, 'program DMA',
        'CPU writes the memory address, word count (' + N + ') and direction into the DMA controller, then goes back to other work.');
      t = p.dmaSetup;
      var cpuT = t;                        // how far the CPU lane has been filled
      prevFree = t;
      for (k = 1; k <= N; k++) {
        ready = prevFree + D;
        add('dev', 'prepare', prevFree, ready, 'prepare word ' + k,
          'The device is preparing word ' + k + '. The CPU is not involved.', k);
        if (ready > cpuT) {
          add('cpu', 'useful', cpuT, ready, 'useful work', 'CPU runs its normal program while the device and DMA controller work on their own.', k);
        }
        add('dma', 'dmamove', ready, ready + p.dmaCycle, 'DMA word ' + k,
          'DMA controller takes the bus (cycle stealing) and moves word ' + k + ' straight into memory.', k);
        add('cpu', 'stalled', ready, ready + p.dmaCycle, 'bus stolen', 'CPU has to wait because the DMA controller is using the memory bus.', k);
        cpuT = ready + p.dmaCycle;
        prevFree = cpuT;
      }
      add('cpu', 'isr', cpuT, cpuT + p.intCost, 'completion interrupt',
        'DMA controller has moved all ' + N + ' words and raises one interrupt. The CPU runs a short routine to note that the transfer is complete.');
      t = cpuT + p.intCost;
    }

    var total = t;
    var sum = { useful: 0, poll: 0, pollok: 0, transfer: 0, isr: 0, setup: 0, stalled: 0 };
    segs.forEach(function (s) { if (s.lane === 'cpu') sum[s.state] += s.end - s.start; });

    var overhead = sum.poll + sum.pollok + sum.transfer + sum.isr + sum.setup;
    var stats = {
      total: total, words: N,
      useful: sum.useful,
      busyWait: sum.poll + sum.pollok,
      cpuTransfer: sum.transfer,
      interruptOverhead: sum.isr,
      setup: sum.setup,
      stalled: sum.stalled,
      ioCpuTime: overhead + sum.stalled,          // everything the CPU spends because of the transfer
      utilisation: total ? sum.useful / total : 0,
      throughput: total ? N / total : 0,
      interrupts: method === 'interrupt' ? N : method === 'dma' ? 1 : 0
    };

    // chronological order for step-by-step playback (CPU first on ties, then DMA, then device)
    var laneRank = { cpu: 0, dma: 1, dev: 2 };
    segs.sort(function (a, b) { return a.start - b.start || laneRank[a.lane] - laneRank[b.lane] || a.end - b.end; });
    return { method: method, name: METHODS[method], segments: segs, stats: stats, total: total };
  }

  function validate(p) {
    var msgs = [];
    function need(key, label, min, max) {
      var v = p[key];
      if (typeof v !== 'number' || isNaN(v) || v < min || v > max || Math.floor(v) !== v) msgs.push(label + ' must be a whole number from ' + min + ' to ' + max + '.');
    }
    need('words', 'Number of words', 1, 64);
    need('devDelay', 'Device delay', 1, 500);
    need('xfer', 'Transfer time per word', 1, 100);
    need('poll', 'Poll time', 1, 100);
    need('intCost', 'Interrupt overhead', 2, 200);
    need('dmaSetup', 'DMA setup time', 1, 500);
    need('dmaCycle', 'DMA cycles per word', 1, 100);
    return msgs;
  }

  function compareAll(p) {
    return ['pio', 'interrupt', 'dma'].map(function (m) { return simulate(m, p); });
  }

  var DEFAULTS = { words: 8, devDelay: 20, xfer: 4, poll: 2, intCost: 12, dmaSetup: 15, dmaCycle: 2 };

  var api = { simulate: simulate, compareAll: compareAll, validate: validate, METHODS: METHODS, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IOSim = api;
})(typeof window !== 'undefined' ? window : this);
