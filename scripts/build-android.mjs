import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = process.argv[2] === 'release';
const env = { ...process.env };
const localJdks = 'D:/tools/cyword-android';
if (!env.CYWORD_JAVA_HOME && existsSync(localJdks)) {
  const candidate = readdirSync(localJdks).find((name) => name.startsWith('jdk-21') && existsSync(path.join(localJdks, name, 'bin/java.exe')));
  if (candidate) env.CYWORD_JAVA_HOME = path.join(localJdks, candidate);
}
env.JAVA_HOME = env.CYWORD_JAVA_HOME || env.JAVA_HOME;
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(homedir(), 'AppData/Local/Android/Sdk');
if (!existsSync(sdk)) throw new Error('请设置 ANDROID_HOME 指向已安装的安卓 SDK。');
writeFileSync(path.join(root, 'android/local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}`);
if (release) {
  const keyDir = path.join(homedir(), '.cyword');
  const settingsPath = env.CYWORD_ANDROID_SIGNING_FILE || path.join(keyDir, 'android-signing.json');
  if (!existsSync(settingsPath)) {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    const signing = { storeFile: path.join(path.dirname(settingsPath), 'android-release.p12'), password: randomBytes(32).toString('hex'), alias: 'cyword' };
    if (existsSync(signing.storeFile)) throw new Error('签名密钥已存在但配置缺失，请恢复签名配置，禁止覆盖密钥。');
    const generated = spawnSync(path.join(env.JAVA_HOME || '', 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool'), ['-genkeypair', '-keystore', signing.storeFile, '-storetype', 'PKCS12', '-storepass:env', 'CYWORD_KEY_PASSWORD', '-keypass:env', 'CYWORD_KEY_PASSWORD', '-alias', signing.alias, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=CYword, O=CYword, C=CN'], { env: { ...env, CYWORD_KEY_PASSWORD: signing.password }, stdio: 'inherit' });
    if (generated.status !== 0) throw new Error('创建安卓签名密钥失败');
    writeFileSync(settingsPath, JSON.stringify(signing, null, 2), { mode: 0o600 });
  }
  const signing = JSON.parse(readFileSync(settingsPath, 'utf8'));
  env.CYWORD_ANDROID_KEYSTORE = signing.storeFile;
  env.CYWORD_ANDROID_STOREPASS = signing.password;
  env.CYWORD_ANDROID_KEY_ALIAS = signing.alias;
}
const build = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [release ? 'assembleRelease' : 'assembleDebug', '--console=plain'], { cwd: path.join(root, 'android'), env, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status || 1);
const variant = release ? 'release' : 'debug';
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
mkdirSync(path.join(root, 'release'), { recursive: true });
const target = path.join(root, 'release', `CYword-Android-${version}${release ? '' : '-debug'}.apk`);
copyFileSync(path.join(root, `android/app/build/outputs/apk/${variant}/app-${variant}.apk`), target);
console.log(`APK: ${target}`);
