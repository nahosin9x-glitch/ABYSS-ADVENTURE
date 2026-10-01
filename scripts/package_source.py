from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1]
excluded={'node_modules','.git','.gradle','build','.idea','__pycache__'}
files=[p for p in root.rglob('*') if p.is_file() and not any(x in excluded for x in p.relative_to(root).parts) and p.name not in {'local.properties','source-manifest.json','.DS_Store'}]
manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
(root/'reports/source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
files.append(root/'reports/source-manifest.json')
out=Path('/mnt/data/Abyss-Adventure-R67-Source.zip');out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(files):z.write(p,Path('abyss-adventure')/p.relative_to(root))
print(str(out),out.stat().st_size,'bytes',len(files),'files')
