import { classAbilities } from '../../packages/content/abilities';
import { content } from '../../packages/content';
export interface SkillCard { name:string; kind:'Main'|'Passive'; text:string; icon:number; iconPath?:string; }
const pct=(v:number)=>`${Math.round(v*100)}%`;
const branches=[['Blood Hunger','Crimson Frenzy'],['Steel Reprisal','Vengeful Resolve'],['Iron Resolve','Renewing Bastion'],['Battle Recovery','Undying Will'],['Arcane Focus','Spellbreaker'],['Dark Covenant','Soul Renewal'],['Blessed Touch','Saving Grace'],['Sacred Armor','Purification'],['Dancer’s Grace','Deadly Rhythm'],['Shadow Power','Void Edge'],['Eagle Eye','Piercing Focus'],['Hunter’s Instinct','Trapmaster']];
export function skillCards(name:string):SkillCard[] {
 const a=classAbilities(name),s=a.skill;
 const branch=content.classPaths.findIndex(p=>p.slice(2).includes(name));
 const path=content.classPaths.find(p=>p.includes(name))!;
 const stage=path.indexOf(name);
 const icon=branch>=0?branch:({Warrior:0,Fighter:0,Knight:2,Mage:4,Wizard:4,Cleric:6,Rogue:8,Assassin:9,Sniper:10} as Record<string,number>)[name];
 let text=`Mana cost: ${s.mp} MP. `;
 if(s.mode==='summon') text+='Summons one Dark Unit. While your unit is alive, use basic attacks and retain MP.';
 else text+=`${s.mode==='heal'?'Heals':s.mode==='shield'?'Shields for':'Deals'} ${pct(s.coef)} ${s.stat}${s.hits>1?` per hit, ${s.hits} hits`:''}. Targets: ${s.targets}. ${s.mode==='damage'?`Damage type: ${s.element}.`:''}`;
 if(s.pierce)text+=` Ignores ${pct(s.pierce)} DEF for this action.`;
 if(s.shieldHP)text+=` Grants a self shield equal to ${pct(s.shieldHP)} maximum HP, even if the attack misses.`;
 if(s.status==='Poison')text+=` Applies Poison: ${pct(s.statusRaw??0)} source ATK per tick for 3 turns.`;
 if(s.status==='Taunt')text+=` Taunts for 2 turns; ${pct(s.statusRaw??0)} target redirection chance.`;
 if(s.status==='Trap')text+=' Applies Trap to each target hit.';
 if(branch===1)text+=` Guarantees one ${pct(a.counterCoef??0)} ATK counter until your next turn.`;
 const result:SkillCard[]=[{name:s.name,kind:'Main',text,icon}];
 const add=(name:string,text:string)=>result.push({name,kind:'Passive',text,icon});
 if(Object.keys(a.bonus).length) add(branch>=0&&branch!==3?branches[branch][0]:({Fighter:'Combat Training',Knight:'Iron Constitution',Wizard:'Arcane Study',Cleric:'Sacred Vigor',Assassin:'Assassin’s Instinct',Sniper:'Steady Aim'} as Record<string,string>)[name]??'Warborn Constitution',Object.entries(a.bonus).map(([stat,value])=>`Base ${stat}: +${pct(value!)}`).join('. ')+'.');
 if(a.lifesteal)add(branches[branch][0],`Restores HP equal to ${pct(a.lifesteal)} actual damage dealt.`);
 if(a.counter)add(branches[branch][0],`${pct(a.counter)} chance to counter immediately for ${pct(a.counterCoef??0)} ATK.`);
 if(a.dr)add(branches[branch][0],`Reduces damage received by ${pct(a.dr)}.`);
 if(a.reactive)add(branches[branch][0],`After a nonlethal hit, restores ${pct(a.reactive)} actual HP lost.`);
 if(a.healHP)add(branches[branch][0],`Each heal additionally restores ${pct(a.healHP)} recipient maximum HP.`);
 if(a.summon!==undefined)add(branches[branch][0],`Your Dark Unit receives ${pct([.1,.15,.2][a.summon])} less damage.`);
 if(a.cycle){
 const value=a.cycleValue??0;
 const effects:Record<string,string>={lifesteal:`Lifesteal becomes ${pct(value)} during this action.`,counter:`Guarantees one ${pct(value)} ATK counter until your next turn.`,shield:`Grants a self shield equal to ${pct(value)} maximum HP.`,reactive:`Recovery becomes ${pct(value)} actual HP lost until your next turn.`,pierce:branch===10?`Adds ${pct(value)} DEF penetration for the action; combines with the main skill.`:`This action ignores ${pct(value)} applicable defense.`,unitHeal:`Restores ${pct(value)} maximum HP to your living Dark Unit.`,heal:`Heals the living ally with the lowest HP ratio for ${pct(value)} MATK, plus Blessed Touch.`,cleanse:`Removes one debuff per ally, up to ${value} living ${value===1?'ally':'allies'}.`,crit:`The first successful hit is a guaranteed critical with a ${pct(value)} multiplier.`,trap:`Places Trap on up to ${value} valid living enemies in target order.`};
 add(branches[branch][1],`Every ${a.cycle} turns: ${effects[a.cycleType??'']??''}`);
 }
 // Stage 1 has one main; stage 2 unlocks its base passive. Later slots remain empty.
 if(stage===0)result.splice(1);
 return result.map((card,slot)=>({...card,iconPath:`/art/skills/${name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${slot}.png`}));
}
