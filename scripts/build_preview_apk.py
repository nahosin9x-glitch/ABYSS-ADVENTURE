"""Build the standalone offline gameplay APK without Gradle. Requires Android SDK tools."""
from pathlib import Path
import os,subprocess,zipfile,shutil,re
root=Path(__file__).resolve().parents[1]
bt=Path(os.environ['ABYSS_BUILD_TOOLS'])
platform=Path(os.environ['ABYSS_ANDROID_JAR'])
build=root/'android-preview/build'
if build.exists():shutil.rmtree(build)
for name in ['classes','dex','generated','assets/public']:(build/name).mkdir(parents=True,exist_ok=True)
for ref in re.findall(r'(?:src|href)="([^"]+)"', (root/'dist/index.html').read_text()):
 if not (root/'dist'/ref.lstrip('/')).is_file():raise RuntimeError('Missing web entry asset: '+ref)
shutil.copytree(root/'dist',build/'assets/public',dirs_exist_ok=True)
def run(*args):subprocess.run([str(x) for x in args],check=True,cwd=root)
run(bt/'aapt2','compile','--dir',root/'android-preview/res','-o',build/'resources.zip')
run(bt/'aapt2','link','-o',build/'unsigned.apk','--manifest',root/'android-preview/AndroidManifest.xml','-I',platform,'--java',build/'generated','-A',build/'assets',build/'resources.zip')
sources=list((root/'android-preview/src').rglob('*.java'))+list((build/'generated').rglob('*.java'))
run('java','com.sun.tools.javac.Main','-source','8','-target','8','-encoding','UTF-8','-classpath',platform,'-d',build/'classes',*sources)
run('java','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--lib',platform,'--min-api','24','--output',build/'dex',*list((build/'classes').rglob('*.class')))
with zipfile.ZipFile(build/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
 for path in (build/'dex').glob('*.dex'):z.write(path,path.name)
run(bt/'zipalign','-f','4',build/'unsigned.apk',build/'aligned.apk')
out=Path(os.environ.get('ABYSS_UNSIGNED_APK',str(root/'android-preview/build/Abyss-Adventure-unsigned.apk')))
out.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(build/'aligned.apk',out)
run(bt/'aapt2','dump','badging',out)
print('Unsigned APK:',out,out.stat().st_size,'bytes')
print('Sign with scripts/sign_repacked_apk.mjs using external ABYSS_SIGNING_KEY and ABYSS_SIGNING_CERT.')
