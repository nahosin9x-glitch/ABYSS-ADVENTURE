import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApkSigner, SigningKey } from 'apk_sign_ts';

const root = resolve(import.meta.dirname, '..');
const unsigned = process.env.ABYSS_UNSIGNED_APK ?? resolve(root, '../recovery/Abyss-Adventure-1.0.1-unsigned.apk');
const output = process.env.ABYSS_APK_OUTPUT ?? resolve(root, '../deliverables/Abyss-Adventure-1.0.1.apk');
const privateKey = process.env.ABYSS_SIGNING_KEY ?? resolve(root, '../recovery/abyss-v13-signing.key.pem');
const certificate = process.env.ABYSS_SIGNING_CERT ?? resolve(root, '../recovery/abyss-v13-signing.cert.pem');
const signer = new ApkSigner({
  signingKey: SigningKey.fromPEM(readFileSync(privateKey, 'utf8'), readFileSync(certificate, 'utf8')),
});
const { signedApk } = await signer.sign(new Uint8Array(readFileSync(unsigned)));
writeFileSync(output, signedApk);
console.log(`APK: ${output} (${signedApk.length} bytes)`);
