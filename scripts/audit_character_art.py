"""Check that every content class has a transparent upright combat sprite."""
import hashlib,json,re
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'packages/content/data.json').read_text())
classes=list(dict.fromkeys(c for path in data['classPaths'] for c in path))
manifest=json.loads((root/'public/art/manifest.json').read_text())
issues=[]
for name in classes:
 slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
 path=root/'public/art/classes'/f'{slug}.png'
 im=Image.open(path)
 if im.mode!='RGBA': issues.append(f'{name}: missing alpha');continue
 a=im.getchannel('A');box=a.getbbox();transparent=a.histogram()[0]/(im.width*im.height)
 if transparent<.2: issues.append(f'{name}: background not transparent enough ({transparent:.2f})')
 if not box or box[3]-box[1] < .72*im.height: issues.append(f'{name}: sprite too short')
 if box and box[3]-box[1] < .9*(box[2]-box[0]): issues.append(f'{name}: wide composition')
 manifest['classes'][name]={'path':f'/art/classes/{slug}.png','label':name,'source':'v24-transparent-full-body','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':list(im.size)}
 print(f'{name}: transparent {transparent:.0%}, bounds {box}')
if issues: raise SystemExit('\n'.join(issues))
(root/'public/art/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'PASS: {len(classes)} class sprites checked; manifest updated.')
