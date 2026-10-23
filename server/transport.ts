import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { Agent, EnvHttpProxyAgent, ProxyAgent } from 'undici';
import type { Dispatcher } from 'undici';
import { isNetworkSettings, newNetworkSettings } from '../shared/network.ts';
import type { NetworkSettings } from '../shared/network.ts';

export class TransportError extends Error {}
export function validateNetwork(value: unknown): NetworkSettings {
  if (value === undefined) return newNetworkSettings();
  if (!isNetworkSettings(value)) throw new TransportError('Invalid proxy, TLS, or cookie settings.');
  return value;
}

function tlsOptions(settings: NetworkSettings['tls'], includeClient: boolean) {
  const { caPem, clientCertPem, clientKeyPem, clientKeyPassphrase } = settings;
  if (Boolean(clientCertPem) !== Boolean(clientKeyPem)) throw new TransportError('Provide both a client certificate and its private key.');
  if (clientKeyPassphrase && !clientKeyPem) throw new TransportError('Add a client private key before entering its passphrase.');
  const options: { ca?: string[]; cert?: string; key?: string; passphrase?: string } = {};
  if (caPem.trim()) {
    const certificates = caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw new TransportError('Custom CA must contain PEM certificates.');
    try { for (const certificate of certificates) new X509Certificate(certificate); }
    catch { throw new TransportError('Custom CA contains an invalid PEM certificate.'); }
    options.ca = [...getCACertificates('default'), ...certificates];
  }
  if (clientCertPem || clientKeyPem) {
    try {
      const cert = new X509Certificate(clientCertPem);
      const privateKey = createPrivateKey({ key: clientKeyPem, passphrase: clientKeyPassphrase || undefined });
      if (!Buffer.from(cert.publicKey.export({ format: 'der', type: 'spki' })).equals(Buffer.from(createPublicKey(privateKey).export({ format: 'der', type: 'spki' })))) throw new Error('mismatch');
    } catch { throw new TransportError('Client certificate and private key are invalid, do not match, or need a different passphrase.'); }
    if (includeClient) { options.cert = clientCertPem; options.key = clientKeyPem; if (clientKeyPassphrase) options.passphrase = clientKeyPassphrase; }
  }
  return options;
}

export function createTransport(settings: NetworkSettings, includeClient = true): Dispatcher | undefined {
  const tls = tlsOptions(settings.tls, includeClient);
  const hasTls = !!(tls.ca || tls.cert);
  if (settings.proxy.mode === 'direct') return hasTls ? new Agent({ connect: tls }) : undefined;
  if (settings.proxy.mode === 'custom') {
    let proxy: URL;
    try { proxy = new URL(settings.proxy.url); } catch { throw new TransportError('Enter a valid HTTP or HTTPS proxy URL.'); }
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new TransportError('Proxy URL must use HTTP or HTTPS and cannot contain a path, query, or fragment.');
    const options = { proxyTunnel: false, ...(hasTls ? { requestTls: tls, proxyTls: { ca: tls.ca } } : {}) };
    return settings.proxy.bypass ? new EnvHttpProxyAgent({ httpProxy: proxy.href, httpsProxy: proxy.href, noProxy: settings.proxy.bypass, ...options })
      : new ProxyAgent({ uri: proxy.href, ...options });
  }
  return new EnvHttpProxyAgent({ proxyTunnel: false, ...(hasTls ? { requestTls: tls, proxyTls: { ca: tls.ca } } : {}) });
}
