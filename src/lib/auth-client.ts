import { prepareWorkspaceRequest, requestFiles, toCurl } from './workspace';
import type { Draft, Workspace } from './workspace';

export interface OAuthActionResponse {
  status: 'pending' | 'exchanging' | 'complete' | 'error' | 'cancelled'; sessionId?: string;
  authorizationUrl?: string; redirectUri?: string; error?: string; tokens?: Record<string, string | number>;
}
export async function oauthAction(input: Record<string, unknown>, signal?: AbortSignal): Promise<OAuthActionResponse> {
  const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The authentication helper is unavailable.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete authentication.');
  return result as OAuthActionResponse;
}

export async function authenticationCurl(workspace: Workspace, draft: Draft, signal?: AbortSignal): Promise<string> {
  const prepared = prepareWorkspaceRequest(workspace, draft, new Map(requestFiles(draft).map(file => [file.id, ''])));
  if (prepared.auth?.authType === 'oauth1') {
    const response = await fetch('/api/auth/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to sign the cURL preview.');
    prepared.headers = [...prepared.headers.filter(header => header.name.toLowerCase() !== 'authorization'), { name: 'Authorization', value: result.authorization }];
  }
  return toCurl(prepared);
}
