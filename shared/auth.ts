export type AuthType = 'inherit' | 'none' | 'basic' | 'bearer' | 'apikey' | 'oauth2' | 'oauth1' | 'digest' | 'aws';
export interface ApiKeyAuth { name: string; value: string; location: 'header' | 'query' }
export interface OAuth2Auth {
  grantType: 'authorization_code' | 'client_credentials'; authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret: string;
  clientAuthentication: 'basic' | 'body' | 'none'; scope: string; redirectUri: string;
  accessToken: string; refreshToken: string; tokenType: string; expiresAt: number; tokenBinding: string; autoRefresh: boolean;
}
export interface OAuth1Auth {
  consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; realm: string;
  signatureMethod: 'HMAC-SHA1' | 'HMAC-SHA256' | 'RSA-SHA1' | 'PLAINTEXT'; privateKey: string;
  requestTokenUrl: string; authorizationUrl: string; accessTokenUrl: string; callbackUri: string;
}
export interface AwsAuth { accessKeyId: string; secretAccessKey: string; sessionToken: string; region: string; service: string }
export interface AuthConfig {
  authType: AuthType; token?: string; username?: string; password?: string;
  apiKey?: ApiKeyAuth; oauth2?: OAuth2Auth; oauth1?: OAuth1Auth; aws?: AwsAuth;
}
export interface OAuth2Tokens { accessToken: string; refreshToken: string; tokenType: string; expiresAt: number; tokenBinding: string }
export interface AuthenticationUpdate { scope: 'request' | 'collection'; id: string; oauth2: OAuth2Tokens; configurationKey: string }

export function newAuthConfig(authType: AuthType = 'none') {
  return { authType, token: '', username: '', password: '',
    apiKey: { name: 'X-API-Key', value: '', location: 'header' as const },
    oauth2: { grantType: 'authorization_code' as const, authorizationUrl: '', tokenUrl: '', clientId: '', clientSecret: '', clientAuthentication: 'none' as const, scope: '', redirectUri: '', accessToken: '', refreshToken: '', tokenType: 'Bearer', expiresAt: 0, tokenBinding: '', autoRefresh: true },
    oauth1: { consumerKey: '', consumerSecret: '', token: '', tokenSecret: '', realm: '', signatureMethod: 'HMAC-SHA1' as OAuth1Auth['signatureMethod'], privateKey: '', requestTokenUrl: '', authorizationUrl: '', accessTokenUrl: '', callbackUri: '' },
    aws: { accessKeyId: '', secretAccessKey: '', sessionToken: '', region: 'us-east-1', service: 'execute-api' },
  };
}

export function normalizedAuth(value?: AuthConfig) {
  const defaults = newAuthConfig();
  return { authType: value?.authType || defaults.authType, token: value?.token ?? '', username: value?.username ?? '', password: value?.password ?? '', apiKey: { ...defaults.apiKey, ...value?.apiKey }, oauth2: { ...defaults.oauth2, ...value?.oauth2 }, oauth1: { ...defaults.oauth1, ...value?.oauth1 }, aws: { ...defaults.aws, ...value?.aws } };
}
export function effectiveAuth(request: AuthConfig, collection?: AuthConfig): AuthConfig {
  const config = normalizedAuth(request.authType === 'inherit' ? collection : request);
  if (config.authType === 'inherit' || config.authType === 'none') return { authType: 'none' };
  if (config.authType === 'basic' || config.authType === 'digest') return { authType: config.authType, username: config.username, password: config.password };
  if (config.authType === 'bearer') return { authType: 'bearer', token: config.token };
  if (config.authType === 'apikey') return { authType: 'apikey', apiKey: config.apiKey };
  if (config.authType === 'oauth2') return { authType: 'oauth2', oauth2: config.oauth2 };
  if (config.authType === 'oauth1') return { authType: 'oauth1', oauth1: config.oauth1 };
  return { authType: 'aws', aws: config.aws };
}

export function resolveAuthValues(value: AuthConfig, resolve: (value: string) => string): AuthConfig {
  const map = (object: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(object).map(([key, value]) => [key,
    typeof value === 'string' && key !== 'authType' ? resolve(value) : value && typeof value === 'object' ? map(value as Record<string, unknown>) : value]));
  return map(value as unknown as Record<string, unknown>) as unknown as AuthConfig;
}

export function isAuthConfig(value: unknown, allowInherit = true): value is AuthConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const auth = value as AuthConfig;
  if (!['none', 'basic', 'bearer', 'apikey', 'oauth2', 'oauth1', 'digest', 'aws', ...(allowInherit ? ['inherit'] : [])].includes(auth.authType)) return false;
  if (['token', 'username', 'password'].some(key => { const v = (auth as unknown as Record<string, unknown>)[key]; return v !== undefined && (typeof v !== 'string' || v.length > 65536); })) return false;
  const defaults = newAuthConfig();
  for (const key of ['apiKey', 'oauth2', 'oauth1', 'aws'] as const) {
    const section = auth[key];
    if (section === undefined) continue;
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    const schema = defaults[key];
    for (const [field, data] of Object.entries(section)) {
      if (!Object.hasOwn(schema, field)) return false;
      const type = typeof (schema as unknown as Record<string, unknown>)[field];
      if (typeof data !== type || type === 'string' && (data as string).length > 65536 || type === 'number' && (!Number.isFinite(data) || (data as number) < 0)) return false;
    }
  }
  const config = normalizedAuth(auth);
  return ['header', 'query'].includes(config.apiKey.location) && ['authorization_code', 'client_credentials'].includes(config.oauth2.grantType)
    && ['basic', 'body', 'none'].includes(config.oauth2.clientAuthentication)
    && ['HMAC-SHA1', 'HMAC-SHA256', 'RSA-SHA1', 'PLAINTEXT'].includes(config.oauth1.signatureMethod);
}

export function applyAuthenticationUpdates<T extends { collections: { id: string; auth?: AuthConfig }[]; saved: { request: AuthConfig & { id: string } }[] }>(workspace: T, updates: AuthenticationUpdate[] = []): T {
  const patch = (auth: AuthConfig, update: AuthenticationUpdate) => auth.authType === 'oauth2' && authConfigurationKey(auth) === update.configurationKey ? ({ ...auth, oauth2: { ...normalizedAuth(auth).oauth2, ...update.oauth2 } }) : auth;
  let current = workspace;
  for (const update of updates) current = update.scope === 'collection'
    ? { ...current, collections: current.collections.map(collection => collection.id === update.id ? { ...collection, auth: patch(collection.auth || newAuthConfig('oauth2'), update) } : collection) }
    : { ...current, saved: current.saved.map(item => item.request.id === update.id ? { ...item, request: patch(item.request, update) } : item) };
  return current;
}

export const authConfigurationKey = (auth?: AuthConfig): string => JSON.stringify(normalizedAuth(auth).oauth2);
