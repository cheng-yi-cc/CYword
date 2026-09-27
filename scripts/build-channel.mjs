export function buildChannel(env = process.env) {
  const production = 'https://cyword.chengyi.me';
  const value = env.CYWORD_ACCEPTANCE_ORIGIN;
  if (!value) return { name: 'production', origin: production, desktopId: 'com.cyword.desktop', productName: 'CYword' };
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.origin === production || url.username || url.password) {
    throw Error('CYWORD_ACCEPTANCE_ORIGIN must be a separate HTTPS origin without a path or credentials');
  }
  return { name: 'acceptance', origin: url.origin, desktopId: 'com.cyword.desktop.acceptance', productName: 'CYword Acceptance' };
}
