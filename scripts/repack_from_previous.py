"""Repack web assets over the previous preview APK when the Android SDK is unavailable.
Use the v13 signing identity when signing so v21 updates v20 without data loss.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
source=root.parent/'deliverables/Abyss-Adventure-v35-test.apk'
out=root.parent/'recovery/Abyss-Adventure-1.0.1-unsigned.apk'
with ZipFile(source) as old, ZipFile(out,'w') as new:
    for info in old.infolist():
        name=info.filename
        if name.startswith('META-INF/') or name.startswith('assets/public/'):
            continue
        if name in ('res/drawable/icon.xml','res/drawable/icon.png'):
            new.writestr('res/drawable/icon.png',(root/'public/art/launcher-icon.png').read_bytes())
            continue
        data=old.read(name)
        if name=='resources.arsc':
            assert data.count(b'res/drawable/icon.xml') + data.count(b'res/drawable/icon.png') == 1
            data=data.replace(b'res/drawable/icon.xml',b'res/drawable/icon.png')
        if name=='AndroidManifest.xml':
            data=bytearray(data)
            previous='0.2.1-r67-idle-roster-v35'.encode('utf-16le')
            assert data.count(previous)==1
            data=data.replace(previous,'1.0.1-r67-official-build2'.encode('utf-16le'))
            marker=bytes.fromhex('ffffffff0800001023000000')
            assert data.count(marker)>=1
            data=data.replace(marker,bytes.fromhex('ffffffff0800001025000000'),1)
            # Replace the Android launcher/installer label, retaining string pool offsets.
            import struct
            old_label='Abyss Gameplay Test'.encode('utf-16le')
            new_label='Abyss Adventure'.encode('utf-16le')
            assert data.count(old_label)==1
            label_at=data.index(old_label)
            assert struct.unpack_from('<H',data,label_at-2)[0]==len(old_label)//2
            struct.pack_into('<H',data,label_at-2,len(new_label)//2)
            data[label_at:label_at+len(old_label)]=new_label+bytes(len(old_label)-len(new_label))
            assert old_label not in data
            # Disable Android debug/test flags in the binary XML attributes.
            import struct
            offset=8
            names=[]
            while offset<len(data):
                kind,header,size=struct.unpack_from('<HHI',data,offset)
                if kind==1:
                    count,styles,flags,start,_=struct.unpack_from('<IIIII',data,offset+8)
                    for i in range(count):
                        pos=offset+start+struct.unpack_from('<I',data,offset+header+i*4)[0]
                        if flags & 256:
                            length=data[pos];pos+=1
                            if length&128:pos+=1
                            length=data[pos];pos+=1
                            if length&128:length=((length&127)<<8)|data[pos];pos+=1
                            names.append(bytes(data[pos:pos+length]).decode('utf-8'))
                        else:
                            length=struct.unpack_from('<H',data,pos)[0];pos+=2
                            if length&32768:length=((length&32767)<<16)|struct.unpack_from('<H',data,pos)[0];pos+=2
                            names.append(bytes(data[pos:pos+length*2]).decode('utf-16le'))
                if kind==258:
                    attrStart,attrSize,attrCount=struct.unpack_from('<HHH',data,offset+24)
                    for i in range(attrCount):
                        pos=offset+16+attrStart+i*attrSize
                        name=struct.unpack_from('<I',data,pos+4)[0]
                        if names[name] in ('debuggable','testOnly'):
                            struct.pack_into('<I',data,pos+8,0xffffffff)
                            data[pos+15]=18
                            struct.pack_into('<I',data,pos+16,0)
                offset+=size
            data=bytes(data)
        new.writestr(info,data)
    for path in sorted((root/'dist').rglob('*')):
        if path.is_file(): new.write(path,'assets/public/'+str(path.relative_to(root/'dist')),compress_type=ZIP_DEFLATED)
print(out, out.stat().st_size)
