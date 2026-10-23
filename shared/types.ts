import type { AuthConfig } from './auth.ts';
import type { CookieRecord, NetworkSettings } from './network.ts';

export interface Header {
  name: string;
  value: string;
}

export interface UploadFile {
  name: string;
  type: string;
  data: string; // Canonical base64; file bytes are never interpolated as variables.
}

export type MultipartPart = { name: string; value: string } | { name: string; file: UploadFile };
export type RequestBody = string | { kind: 'binary'; file: UploadFile } | { kind: 'multipart'; parts: MultipartPart[] };

export interface HttpRequest {
  url: string;
  method: string;
  headers: Header[];
  body?: RequestBody;
  timeoutMs: number;
  followRedirects: boolean;
  auth?: AuthConfig;
  network?: NetworkSettings;
  cookies?: CookieRecord[];
}

export interface HttpResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Header[];
  body: string;
  encoding: 'utf8' | 'base64';
  durationMs: number;
  size: number;
  cookies?: CookieRecord[];
}
