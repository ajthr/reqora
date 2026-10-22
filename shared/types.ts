export interface Header {
  name: string;
  value: string;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers: Header[];
  body?: string;
  timeoutMs: number;
  followRedirects: boolean;
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
}
