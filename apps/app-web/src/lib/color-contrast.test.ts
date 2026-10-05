import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio,mixColor,opaqueColor} from './color-contrast.ts';
test('WCAG reference endpoints and a borderline pair',()=>{
 assert.equal(contrastRatio('#ffffff','#000000'),21);
 assert.equal(contrastRatio('#123456','#123456'),1);
 assert.ok(contrastRatio('#767676','#ffffff')>=4.5);
 assert.ok(contrastRatio('#777777','#ffffff')<4.5);
});
test('opacity is composited before measuring contrast',()=>{
 assert.equal(mixColor('#ffffff','#000000',.5),'#808080');
 assert.equal(opaqueColor('rgba(255, 255, 255, 0.5)','#000000'),'#808080');
 assert.equal(opaqueColor('#ffffff80','#000000'),'#808080');
 assert.ok(contrastRatio(mixColor('#ffffff','#000000',.3),'#000000')<3);
});
