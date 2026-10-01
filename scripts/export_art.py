"""Export approved static concept sheets into ID-addressed runtime assets.

No generative redraw: each output uses the corresponding approved source board.
Source/cell/provenance are kept in public/art/manifest.json for review.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import hashlib
import json
import re

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'docs/art'
OUT = ROOT / 'public/art'
DATA = json.loads((ROOT / 'packages/content/data.json').read_text())
SELECTED = json.loads((SRC / 'inventory-concept-map03-10/SELECTED-IDS.json').read_text())
manifest: dict[str, dict[str, dict]] = defaultdict(dict)


def slug(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def grid_rect(index: int, cols: int, rows: int, width: int, height: int,
              bottom: float = .85) -> tuple[int, int, int, int]:
    c, r = index % cols, index // cols
    cw, ch = width / cols, height / rows
    return (round((c + .035) * cw), round((r + .035) * ch),
            round((c + .965) * cw), round((r + bottom) * ch))


def cut(source: Path, rect: tuple[int,int,int,int], size: int) -> Image.Image:
    im = Image.open(source).convert('RGB')
    region = np.asarray(im.crop(rect)).copy()
    lo = region.min(axis=2).astype(np.int16)
    hi = region.max(axis=2).astype(np.int16)
    # Neutral charcoal belongs to the board background. Flood only from its
    # perimeter so dark holes inside a closed item/actor remain untouched.
    candidate = (hi < 83) & ((hi - lo) < 24)
    seeds = np.zeros(candidate.shape, dtype=bool)
    seeds[0,:] = seeds[-1,:] = seeds[:,0] = seeds[:,-1] = True
    background = ndimage.binary_propagation(seeds & candidate, mask=candidate)
    foreground = ~background
    # Drop isolated dark board specks and decorative frame remnants.
    labels, count = ndimage.label(foreground)
    areas = np.bincount(labels.ravel())
    keep = np.zeros(count + 1, dtype=bool)
    keep[1:] = areas[1:] >= max(10, size // 32)
    foreground &= keep[labels]
    yy, xx = np.nonzero(foreground)
    if len(xx) == 0:
        raise ValueError(f'empty crop: {source} {rect}')
    x0,x1=max(0,int(xx.min())-3),min(region.shape[1],int(xx.max())+4)
    y0,y1=max(0,int(yy.min())-3),min(region.shape[0],int(yy.max())+4)
    rgba = np.dstack([region,foreground.astype(np.uint8)*255])[y0:y1,x0:x1]
    art = Image.fromarray(rgba,'RGBA')
    art.thumbnail((size-8,size-8),Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA',(size,size))
    canvas.alpha_composite(art,((size-art.width)//2,(size-art.height)//2))
    return canvas


def write(kind: str, id_: str, source: Path, rect: tuple[int,int,int,int],
          size: int, label: str | None = None) -> None:
    dest = OUT / kind / (slug(id_) if kind in {'classes','statuses','navigation','units'} else id_)
    dest = dest.with_suffix('.png')
    dest.parent.mkdir(parents=True,exist_ok=True)
    temp=dest.with_suffix('.tmp')
    cut(source,rect,size).save(temp,format='PNG',optimize=True)
    if temp.stat().st_size==0:
        raise ValueError(f'zero-byte sprite: {source} {rect}')
    with Image.open(temp) as check:
        check.verify()
    temp.replace(dest)
    manifest[kind][id_] = {'path':'/art/'+dest.relative_to(OUT).as_posix(),
                            'source':source.relative_to(ROOT).as_posix(),
                            'rect':list(rect),'label':label or id_,
                            'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}


def board(kind: str, source: Path, ids: list[str], cols: int, rows: int,
          size: int, bottom: float=.85) -> None:
    im = Image.open(source)
    assert len(ids) <= cols*rows
    for i,id_ in enumerate(ids):
        write(kind,id_,source,grid_rect(i,cols,rows,*im.size,bottom),size)


def characters() -> None:
    paths = DATA['classPaths']
    base = ['Warrior','Mage','Rogue']
    board('classes',SRC/'characters/lv01-starter-party-approved.png',base,3,1,256,.83)
    board('classes',SRC/'characters/lv10-class1-concept-approved.png',
          ['Fighter','Knight','Wizard','Cleric','Assassin','Sniper'],3,2,256,.88)
    for stage,folder in [(2,SRC/'characters/lv25'),(3,SRC/'characters/lv50-lv75/lv50'),
                         (4,SRC/'characters/lv50-lv75/lv75')]:
        for family in base:
            file = (folder/f'{family.lower()}-branches-approved.png' if stage==2
                    else folder/f'{family.lower()}.png')
            ids = [p[stage] for p in paths if p[0]==family]
            board('classes',file,ids,2,2,256,.88)
    assert len(manifest['classes'])==45


def enemies() -> None:
    files=sorted((SRC/'monster-concept-map01-10').glob('map??-*.png'))
    assert len(files)==10
    layout={1:(3,2),2:(3,2),3:(4,2),4:(4,2),5:(4,2),
            6:(3,3),7:(4,2),8:(5,2),9:(3,3),10:(5,2)}
    for m,file in enumerate(files,1):
        entries=[e for e in DATA['enemies'] if e['map']==m]
        cols,rows=layout[m];w,h=Image.open(file).size
        for i,e in enumerate(entries):
            if m in (1,3,4,5) and i==len(entries)-1:
                # Boss artwork spans the last two cells in the bottom row.
                rect=(round((.43 if m==1 else .55)*w),round((rows-1+.02)*h/rows),
                      round(.98*w),round((rows-1+.79)*h/rows))
            elif m==1 and i==3:
                rect=grid_rect(3,3,2,w,h,.78)
            else:
                rect=grid_rect(i,cols,rows,w,h,.78)
            write('enemies',e['id'],file,rect,384 if e['kind']!='normal' else 256,e['name'])
    assert len(manifest['enemies'])==len(DATA['enemies'])==78


def inventory() -> None:
    groups: dict[str,list[dict]] = defaultdict(list)
    for x in SELECTED: groups[x['board']].append(x)
    for relative,entries in groups.items():
        entries.sort(key=lambda x:x['position'])
        src=SRC/'inventory-concept-map03-10'/relative
        n=len(entries)
        two_by_two=n==4 and ('map03-completion' in relative or 'map08-completion' in relative)
        cols,rows=(1,1) if n==1 else ((2,2) if two_by_two else (3,2))
        w,h=Image.open(src).size
        for entry in entries:
            index=entry['position']-1
            if n==4 and not two_by_two and index==3:
                index=4 if 'map09-completion' in relative else 3
            rect=grid_rect(index,cols,rows,w,h,.79 if n==4 else .82)
            write('items' if entry['type']=='equipment' else 'materials',
                  entry['id'],src,rect,64,entry['name'])

    # Map 1 was approved on four separate boards before SELECTED-IDS existed.
    base=SRC/'concepts'
    positions=[
        ('set04-bronze-samples-approved.png',3,2,[
            ('items','eq_ashfall_bronze_sword',0),('items','eq_ashspirit_bronze_staff',1),
            ('items','eq_ashveil_bronze_twin_blades',2),('items','eq_ashfall_bronze_helm',3),
            ('materials','mat_bronze_scrap',4),('materials','mat_rotten_bone_shard',5)]),
        ('set06-bronze-hands-feet-approved.png',3,2,[
            ('items','eq_ashfall_bronze_gauntlets',0),('items','eq_ashspirit_bronze_gloves',1),
            ('items','eq_ashveil_bronze_gloves',2),('items','eq_ashfall_bronze_greaves',3),
            ('items','eq_ashspirit_bronze_boots',4),('items','eq_ashveil_bronze_boots',5)]),
        ('set07-bronze-hood-bow-accessories-approved.png',4,2,[
            ('items','eq_ashspirit_bronze_hood',0),('items','eq_ashveil_bronze_hood',1),
            ('items','eq_ashveil_bronze_bow',2),('items','eq_bronze_ashbone_hunter_ring',3),
            ('items','eq_bronze_ashbone_spirit_ring',4),('items','eq_bronze_ashscale_necklace',5),
            ('items','eq_bronze_woodland_ward_necklace',6)]),
        ('set08-tier1-materials-approved.png',3,2,[
            ('materials','mat_raw_hide',0),('materials','mat_snake_scale',1),
            ('materials','mat_dry_wood',2),('materials','mat_torn_cloth',3),
            ('materials','mat_alpha_wolf_fang',4),('materials','mat_enhancement_stone',5)])]
    for name,cols,rows,values in positions:
        src=base/name;w,h=Image.open(src).size
        for kind,id_,i in values:
            write(kind,id_,src,grid_rect(i,cols,rows,w,h,.82),64)
    for kind,key in [('items','recipes'),('materials','materials')]:
        expected={v['id'] for v in DATA[key]}
        assert set(manifest[kind])==expected,(kind,len(manifest[kind]),expected-set(manifest[kind]))


def specials_and_ui() -> None:
    d=SRC/'special-actors'
    board('units',d/'dark-units-souls-approved.png',
          ['Summoner','Necromancer','Devil Lich'],3,1,256,.88)
    board('units',d/'enemy-minions-concept-approved.png',
          ['Ore Spawn','Rift Spawn','Court Wraith'],3,1,256,.83)
    source=d/'pale-squirrel-concept-approved.png';w,h=Image.open(source).size
    write('units','Pale Squirrel',source,(round(w*.18),round(h*.15),round(w*.82),round(h*.72)),256)
    grave=OUT/'units/gravestone.png'
    if grave.exists():
        manifest['units']['Gravestone']={'path':'/art/units/gravestone.png',
            'source':'public/art/units/gravestone.png',
            'sha256':hashlib.sha256(grave.read_bytes()).hexdigest()}
    source=SRC/'ui-status/status-14-concept-approved.png'
    status=['Poison','Burn','Bleeding','Stun','Slow','Darkness','Weaken',
            'Defense Break','Wither','Skill Seal','Taunt','Trap','Doom Mark','Shield']
    board('statuses',source,status,7,2,32,.72)
    source=SRC/'concepts/set05-ui-essentials-approved.png'
    board('navigation',source,['World','Party','Inventory','Craft','Journal','Tasks','Settings','Tombstone'],4,2,64,.70)


def backgrounds() -> None:
    folder=SRC/'backgrounds/map01-10'
    files=sorted(folder.glob('map??-*.png'))
    assert len(files)==10
    files.append(SRC/'backgrounds/main-menu-background-concept-approved.png')
    for i,source in enumerate(files):
        dest=OUT/'backgrounds'/('menu.webp' if i==10 else f'map{i+1:02d}.webp')
        dest.parent.mkdir(parents=True,exist_ok=True)
        im=Image.open(source).convert('RGB')
        w,h=im.size
        cropw=min(w,round(h*9/16))
        croph=min(h,round(w*16/9))
        im=im.crop(((w-cropw)//2,(h-croph)//2,(w+cropw)//2,(h+croph)//2))
        im.resize((1080,1920),Image.Resampling.LANCZOS).save(dest,'WEBP',quality=82,method=6)
        id_='menu' if i==10 else f'map{i+1:02d}'
        manifest['backgrounds'][id_]={'path':'/art/'+dest.relative_to(OUT).as_posix(),
                                      'source':source.relative_to(ROOT).as_posix(),
                                      'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}


def main() -> None:
    characters();enemies();inventory();specials_and_ui();backgrounds()
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print({kind:len(items) for kind,items in manifest.items()})
    print('total',sum(map(len,manifest.values())))


if __name__=='__main__': main()
