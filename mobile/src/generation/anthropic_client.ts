/**
 * Minimal Anthropic Messages API client (spec Section 6, generation). The key is read from
 * the Keychain by the caller and sent only to api.anthropic.com.
 */
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface MessageRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
}

export interface MessageResult {
  readonly text: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly stopReason: string | null;
}

export class GenerationHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GenerationHttpError';
  }
}

interface MessagesResponse {
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly stop_reason?: string;
  readonly error?: { readonly message?: string };
}

export async function createMessage(fetchImpl: FetchLike, request: MessageRequest): Promise<MessageResult> {
  const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as MessagesResponse).error?.message ?? '';
    } catch {
      detail = '';
    }
    throw new GenerationHttpError(response.status, `Anthropic API ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const body = (await response.json()) as MessagesResponse;
  const text = (body.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
  return {
    text,
    inputTokens: body.usage?.input_tokens ?? null,
    outputTokens: body.usage?.output_tokens ?? null,
    stopReason: body.stop_reason ?? null,
  };
}
