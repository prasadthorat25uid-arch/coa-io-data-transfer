// Run with:  node tests/io.test.js
const assert = require('assert');
const IO = require('../io.js');

const P = (o) => Object.assign({}, IO.DEFAULTS, o);

// hand-worked single-word cases
let r = IO.simulate('pio', P({ words: 1, devDelay: 10, poll: 2, xfer: 2 }));
assert.strictEqual(r.total, 12);          // 4 failed polls (8) + 1 good poll (2) + transfer (2)... ready at 10, poll ends at 10
assert.strictEqual(r.stats.useful, 0);
assert.strictEqual(r.stats.busyWait, 10);
assert.strictEqual(r.stats.cpuTransfer, 2);

r = IO.simulate('interrupt', P({ words: 1, devDelay: 10, xfer: 2, intCost: 6 }));
assert.strictEqual(r.total, 18);          // 10 useful + 3 entry + 2 transfer + 3 exit
assert.strictEqual(r.stats.useful, 10);
assert.strictEqual(r.stats.interruptOverhead, 6);

r = IO.simulate('dma', P({ words: 1, devDelay: 10, dmaSetup: 5, dmaCycle: 2, intCost: 6 }));
assert.strictEqual(r.total, 23);          // 5 setup + 10 useful + 2 stolen + 6 completion interrupt
assert.strictEqual(r.stats.useful, 10);
assert.strictEqual(r.stats.stalled, 2);

// CPU lane must tile the whole run with no gaps or overlaps, for many parameter sets
for (const method of ['pio', 'interrupt', 'dma']) {
  for (const words of [1, 3, 8, 33]) {
    for (const devDelay of [1, 5, 20, 100]) {
      for (const poll of [1, 3]) {
        const res = IO.simulate(method, P({ words, devDelay, poll, xfer: 3, intCost: 7, dmaSetup: 9, dmaCycle: 3 }));
        const cpu = res.segments.filter(s => s.lane === 'cpu').sort((a, b) => a.start - b.start);
        let t = 0;
        for (const s of cpu) { assert.strictEqual(s.start, t, `${method} gap/overlap at ${t}`); t = s.end; }
        assert.strictEqual(t, res.total, `${method} CPU lane ends at total`);
        // every word moved exactly once
        const moves = res.segments.filter(s => s.state === 'transfer' || s.state === 'dmamove');
        assert.strictEqual(moves.length, words, `${method} moved ${moves.length} of ${words}`);
        const st = res.stats;
        assert.strictEqual(st.useful + st.busyWait + st.cpuTransfer + st.interruptOverhead + st.setup + st.stalled, res.total);
      }
    }
  }
}

// The point of the exercise: with a slow device, polling wastes the CPU, interrupts and DMA free it
const cmp = IO.compareAll(P({ words: 16, devDelay: 50 }));
const [pio, intr, dma] = cmp;
assert.strictEqual(pio.stats.utilisation, 0);
assert.ok(intr.stats.utilisation > 0.5);
assert.ok(dma.stats.utilisation > intr.stats.utilisation);
assert.ok(dma.stats.ioCpuTime < intr.stats.ioCpuTime && intr.stats.ioCpuTime <= pio.stats.ioCpuTime);

// ... but for a very fast device and one word, interrupt/DMA overhead is not worth it
const tiny = IO.compareAll(P({ words: 1, devDelay: 1 }));
assert.ok(tiny[0].total < tiny[1].total && tiny[0].total < tiny[2].total);

// DMA takes one interrupt, interrupt-driven takes one per word
assert.strictEqual(dma.stats.interrupts, 1);
assert.strictEqual(intr.stats.interrupts, 16);

// validation
assert.strictEqual(IO.validate(IO.DEFAULTS).length, 0);
assert.ok(IO.validate(P({ words: 0 })).length === 1);
assert.ok(IO.validate(P({ poll: 2.5 })).length === 1);

console.log('io.test.js: all checks passed');
