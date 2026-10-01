"""Deterministic R67 importer. A missing or contradictory record fails the build."""
from pathlib import Path
import re,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'docs/Abyss-Adventure-ROADMAP-1.md';s=source.read_text()
def section(title):
 m=re.search(r'^#{2,3} '+re.escape(title)+r'[^\n]*\n',s,re.M);assert m,title
 end=re.search(r'^#{2,3} ',s[m.end():],re.M)
 return s[m.end():m.end()+end.start()] if end else s[m.end():]
def tables(text):
 out=[];current=[]
 for line in text.splitlines()+['']:
  if line.startswith('|'):current.append([c.strip().replace('`','') for c in line.strip().strip('|').split('|')])
  elif current:out.append(current[2:]);current=[]
 return out
def tab(title):return tables(section(title))[0]
def num(v):return int(v.replace('.','').replace(',',''))
def slug(v):return re.sub(r'[^a-z0-9]+','_',v.lower()).strip('_')
def key(v):return re.sub(r'[^a-z0-9]','',v.lower())
def clean(v):return re.sub(r'^(Field Boss:|Boss:|Hidden:|Mini Boss:)\s*','',v).split(' —')[0].strip()
def rangeof(v):
 a=[int(x) for x in re.findall(r'\d+',v)];return [a[0],a[-1]]
data={'version':'R67','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
data['stats']={c:[list(map(num,r)) for r in tab('A.'+str(i)+' '+c)] for i,c in enumerate(['Warrior','Mage','Rogue'],1)}
data['exp']=[num(r[2]) if re.match(r'\d',r[2]) else 0 for r in tab('A.4')]
data['rosterPrices']=[0]+[num(r[1]) for r in tab('A.5')[1:]]
data['classPaths']=tab('B.1');data['classDescriptions']={}
for i in range(2,8):
 for r in tab('B.'+str(i)):
  name=r[0].split('→')[-1].strip() if i==7 else re.sub(r'\s+(25|50).*','',r[0]).strip()
  data['classDescriptions'][name]=' · '.join(r[1:])
enemies=[];skills={};rewards={};drops={}
for i in [1,4,5,6,7,8,9,10]:
 for t in tables(section('C.'+str(i))):
  for r in t:
   if (len(r)==11 and i==1) or len(r)==10:
    m=int(r[0]) if i==1 else i;rr=r[1:] if i==1 else r;name=clean(rr[0])
    typ='hidden' if 'Hidden:' in rr[0] else 'mini' if 'Mini' in rr[0] else 'boss' if 'Boss:' in rr[0] or name in ['Ash Wolf Alpha','Undead Chieftain','Marsh Broodmother'] else 'normal'
    enemies.append(dict(id='enemy_'+slug(name),name=name,map=m,kind=typ,level=num(rr[1]),stats=dict(zip(['HP','ATK','MATK','DEF','ACC','CRIT','EVA'],map(num,rr[2:9]))),flying=bool(re.search('Bay|Flying',rr[9])),ranged=bool(re.search('xa|ranged',rr[9],re.I))))
   elif len(r)==2:skills[key(clean(r[0]))]=r[1]
   elif len(r)==3 and re.match(r'^\d',r[1]):rewards[key(clean(r[0]))]=[num(r[1]),num(r[2])]
   elif len(r)==3:drops[key(clean(r[0]))]=r[1:]
for r in tab('C.2'):skills[key(r[0])]=r[2]
for r in tab('C.3 '):rewards[key(r[1])]=[num(r[2]),num(r[3])]
for title in ['C.3.2','C.3.3']:
 for r in tab(title):drops[key(r[0])]=r[1:]
for e in enemies:
 e['description']=skills.get(key(e['name']),'');assert key(e['name']) in rewards,e['name']
 e['exp'],e['gold']=rewards[key(e['name'])];e['drops']=drops.get(key(e['name']),[])
 e['ranged']=e['ranged'] or e['stats']['ATK']==0 or 'Archer' in e['name']
data['enemies']=enemies
mapping={key(r[0]):r[1:] for r in tab('E.3')}
main={(int(r[0]),r[1],r[2]):dict(zip(['HP','ATK','MATK','DEF'],map(num,r[3:]))) for r in tab('E.1')}
acc={key(r[1]):(dict(zip(['HP','ATK','MATK','DEF','ACC'],map(num,r[2:7]))),r[7]) for r in tab('E.2')}
recipes=[]
for tier in range(1,11):
 for r in tab('D.'+str(tier)+' Map'):
  ident,name=r[0].split(' — ',1);cls,slot=mapping[key(name)];ingredients=[]
  for part in re.split(r'\s*\+\s*',r[1]):
   m=re.fullmatch(r'(\d+) (.+)',part);assert m,part
   ingredients.append(dict(id='mat_'+slug(m[2]),name=m[2],quantity=int(m[1])))
  if slot in ['Ring','Necklace']:stats,fixed=acc[key(name)]
  else:stats=main[tier,cls,slot];fixed='DEF Pierce 10%' if tier in [4,5] and slot=='Weapon' else ''
  recipes.append(dict(id=ident,name=name,tier=tier,baseClass=cls,slot=slot,ingredients=ingredients,stats=stats,fixed=fixed,ranged=cls=='Mage' or 'Bow' in name or 'Longbow' in name))
data['recipes']=recipes
data['rarities']=['Weak','Common','Uncommon','Rare','Epic','Perfect','Legendary','Supreme']
data['rarityWeights']=[[round(float(x.replace(',','.'))*100) if x!='—' else 0 for x in r[1:]] for r in tab('F.1')]
data['flatAffixes']={r[0]+'_'+r[1]:[rangeof(x) for x in r[2:]] for n in ['F.2','F.3'] for r in tab(n)}
data['counterRanges']={r[0]:[rangeof(x) for x in r[1:]] for r in tab('F.4')}
data['dotRanges']={r[0]:[rangeof(x) for x in r[1:]] for r in tab('F.5')}
data['salePrices']=[[num(x) if x!='—' else 0 for x in r[1:]] for r in tab('F.6')]
data['daily']=[dict(id=r[0],name=r[1],group=i//5,target=int(re.findall(r'\d+',r[2])[-1]),goldFactor=int(r[3][0])) for i,r in enumerate(tab('G. Daily'))]
data['mapNames']=['Ashwood Forest','Graymist Hills','Wild Marsh','Forgotten Cemetery','Lament Mine','Hanging Village','Blood Monastery','Cursed Citadel','Bone Valley','Soul-Devouring Abyss']
data['tiers']=['Bronze','Iron','Steel','Silver','Gold','Platinum','Titanium','Mithril','Adamant','Orichalcum'];data['costFactors']=[10,30,130,240,300,400,530,710,1030,1660]
materials={}
def mat(name,tier,weight=1):
 if name!='—':materials['mat_'+slug(name)]=dict(id='mat_'+slug(name),name=name,tier=tier,sale=max(1,3*data['costFactors'][tier-1]*weight//100))
for e in enemies:
 for d in e['drops']:mat(d,e['map'])
for name in ['Raw Hide','Rotten Bone Shard','Snake Scale','Dry Wood','Torn Cloth']:mat(name,1)
for i,t in enumerate(data['tiers'],1):mat(t+' Scrap',i)
for r in tab('C.11'):mat(r[1],int(re.search(r'\d+',r[0])[0]),5 if 'Ember' in r[1] else 3)
materials['mat_enhancement_stone']=dict(id='mat_enhancement_stone',name='Enhancement Stone',tier=1,sale=5)
data['materials']=list(materials.values())
for r in recipes:
 for m in r['ingredients']:assert m['id'] in materials,(r['name'],m)
assert len(recipes)==174 and len(data['daily'])==30 and len(enemies)==78
assert len(set(p for row in data['classPaths'] for p in row))==45
assert sum(data['exp'])==5622400 and all(sum(r)==10000 for r in data['rarityWeights'])
out=ROOT/'packages/content/data.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(f'Imported {len(enemies)} encounters, {len(recipes)} recipes, {len(materials)} materials, 45 classes, 30 dailies')
