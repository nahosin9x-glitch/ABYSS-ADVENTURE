"""Verify APK v2 RSA signature, content digest and optional existing signer identity."""
import hashlib
import struct
import sys
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def lp(data, offset=0):
    size = struct.unpack_from('<I', data, offset)[0]
    return data[offset+4:offset+4+size], offset+4+size


def verify(path):
    data = Path(path).read_bytes()
    eocd = data.rfind(b'PK\x05\x06')
    assert eocd >= 0, 'Missing ZIP directory'
    central = struct.unpack_from('<I', data, eocd+16)[0]
    size = struct.unpack_from('<Q', data, central-24)[0]
    assert data[central-16:central] == b'APK Sig Block 42'
    start = central - size - 8
    assert struct.unpack_from('<Q', data, start)[0] == size
    offset = start + 8
    v2 = None
    while offset < central-24:
        length = struct.unpack_from('<Q', data, offset)[0]
        ident = struct.unpack_from('<I', data, offset+8)[0]
        if ident == 0x7109871a:
            v2 = data[offset+12:offset+8+length]
        offset += 8+length
    assert v2 is not None, 'Missing APK v2 signer'
    signers, _ = lp(v2)
    signer, _ = lp(signers)
    signed, pos = lp(signer)
    signatures, pos = lp(signer, pos)
    public, _ = lp(signer, pos)
    record, _ = lp(signatures)
    algorithm = struct.unpack_from('<I', record)[0]
    assert algorithm in (0x103, 0x104), 'Unsupported signature algorithm'
    signature, _ = lp(record, 4)
    digest_records, pos = lp(signed)
    certificates, _ = lp(signed, pos)
    cert_bytes, _ = lp(certificates)
    cert = x509.load_der_x509_certificate(cert_bytes)
    expected_public = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    assert expected_public == public
    hash_alg = hashes.SHA512() if algorithm == 0x104 else hashes.SHA256()
    cert.public_key().verify(signature, signed, padding.PKCS1v15(), hash_alg)
    digest_record, _ = lp(digest_records)
    assert struct.unpack_from('<I', digest_record)[0] == algorithm
    expected_digest, _ = lp(digest_record, 4)
    hash_fn = hashlib.sha512 if algorithm == 0x104 else hashlib.sha256
    tail = bytearray(data[eocd:])
    struct.pack_into('<I', tail, 16, start)
    chunks = []
    for section in [data[:start], data[central:eocd], bytes(tail)]:
        for i in range(0, len(section), 1024*1024):
            chunk = section[i:i+1024*1024]
            chunks.append(hash_fn(b'\xa5'+struct.pack('<I',len(chunk))+chunk).digest())
    actual = hash_fn(b'\x5a'+struct.pack('<I',len(chunks))+b''.join(chunks)).digest()
    assert actual == expected_digest, 'APK contents do not match signed digest'
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    print(f'Verified APK v2 signature and content digest: {Path(path).name}')
    return fingerprint

fingerprint = verify(sys.argv[1])
if len(sys.argv) > 2:
    assert fingerprint == verify(sys.argv[2]), 'Signer changed; update would fail'
    print('Signer matches previous APK; update installation supported')
