import {existsSync,readFileSync} from "node:fs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {skillCards} from '../apps/game/skills';
import {content} from '../packages/content';
test('all 45 class skill cards use English, one Main and named passives with valid icon indexes',()=>{
 const paths=new Set<string>(); const hashes=new Set<string>();
 for(const name of new Set(content.classPaths.flat())){
  const cards=skillCards(name);
  assert.equal(cards.filter(c=>c.kind==='Main').length,1);
  for(const c of cards){
   assert.ok(c.iconPath);assert.ok(existsSync('public'+c.iconPath));
   assert.ok(!paths.has(c.iconPath!));paths.add(c.iconPath!);
   const bytes=readFileSync('public'+c.iconPath).toString('base64');assert.ok(!hashes.has(bytes));hashes.add(bytes);
  }
  assert.ok(cards.every(c=>!/^Passive \d/.test(c.name)));
  assert.ok(cards.every(c=>!/\b(nền|mỗi|địch|hồi|lượt)\b/iu.test(c.text)));
 }
 assert.equal(paths.size,126);
 assert.equal(skillCards('Warrior').length,1);
 assert.equal(skillCards('Fighter').length,2);
 assert.equal(skillCards('Dreadlord').length,4);
});
