import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

let connected: boolean | undefined;
let started = false;
export function networkIsOnline() {
  return connected ?? (typeof navigator === 'undefined' || navigator.onLine);
}
export function startNetworkMonitor() {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  let generation = 0;
  const publish = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  };
  void (async () => {
    await Network.addListener('networkStatusChange', status => { generation++; publish(status.connected); });
    const before = generation;
    const status = await Network.getStatus();
    if (before === generation) publish(status.connected);
  })().catch(() => { console.warn('Native network status unavailable; network errors remain retryable.'); });
}
