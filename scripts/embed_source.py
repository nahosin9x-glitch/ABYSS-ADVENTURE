"""Embed audit-friendly project source in the single offline APK."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
out = root / 'dist/source/abyss-source.zip'
out.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED, compresslevel=8) as archive:
    for folder in ('apps', 'packages', 'tests', 'scripts', 'android-preview/src', 'android-preview/res'):
        for file in sorted((root / folder).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts:
                archive.write(file, file.relative_to(root))
    for name in ('index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'capacitor.config.ts', 'android-preview/AndroidManifest.xml'):
        file = root / name
        if file.is_file(): archive.write(file, name)
print(f'Embedded source: {out.stat().st_size} bytes')
