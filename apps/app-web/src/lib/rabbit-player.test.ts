import assert from 'node:assert/strict';
import test from 'node:test';
import { playRabbit, type RabbitClock, type RabbitFrame } from './rabbit-player.ts';
function manualClock() {
  let now = 0, id = 0;
  const timers = new Map<number, {at:number; cb:()=>void}>();
  const clock: RabbitClock = {
    schedule(cb, delay) { timers.set(++id,{at:now+delay,cb}); return id; },
    cancel(timer) { timers.delete(timer as number); },
  };
  return {clock, advance(ms:number) {
    const end = now+ms;
    for (;;) {
      const next = [...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next || next[1].at>end) break;
      now=next[1].at; timers.delete(next[0]); next[1].cb();
    }
    now=end;
  }, pending:()=>timers.size};
}
test('ears remain raised throughout prolonged typing, without cycling or timers',()=>{
 const time=manualClock(), frames:RabbitFrame[]=[];
 const stop=playRabbit('typing',f=>frames.push(f),time.clock);
 time.advance(280); assert.equal(frames.at(-1),'attention');
 time.advance(30000); assert.equal(frames.at(-1),'attention');
 assert.equal(frames.length,3); assert.equal(time.pending(),0); stop();
});
test('typing pause lowers the ears progressively; renewed typing cancels that descent',()=>{
 const time=manualClock(); let frame:RabbitFrame='repos';
 let stop=playRabbit('relaxing',f=>{frame=f},time.clock);
 time.advance(150); assert.equal(frame,'lever1');
 stop(); stop=playRabbit('typing',f=>{frame=f},time.clock);
 time.advance(5000); assert.equal(frame,'attention');
 stop(); playRabbit('relaxing',f=>{frame=f},time.clock);time.advance(300);assert.equal(frame,'repos');
});
for (const state of ['waiting','streaming'] as const) test(`${state} repeats and cancels without late frames`,()=>{
 const time=manualClock(), frames:RabbitFrame[]=[];
 const stop=playRabbit(state,f=>frames.push(f),time.clock);
 time.advance(15000);assert.ok(frames.length>10);
 stop();const count=frames.length;time.advance(30000);assert.equal(frames.length,count);assert.equal(time.pending(),0);
});
test('changing to offline/idle cancels the active movement',()=>{
 const time=manualClock();let frame:RabbitFrame='repos';
 const stop=playRabbit('typing',f=>{frame=f},time.clock);time.advance(140);stop();
 playRabbit('idle',f=>{frame=f},time.clock);time.advance(5000);assert.equal(frame,'repos');
});
