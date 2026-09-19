function readOAuthParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOAuthParamsFromUrl(raw: string): { code: string | null; state: string | null } | null {
  try {
    const url = new URL(raw);
    const code = readOAuthParam(url.searchParams, 'code')
      ?? readOAuthParam(url.searchParams, 'authorization_code');
    const state = readOAuthParam(url.searchParams, 'state');
    if (code || state) return { code, state };

    if (url.hash) {
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      return {
        code: readOAuthParam(hashParams, 'code') ?? readOAuthParam(hashParams, 'authorization_code'),
        state: readOAuthParam(hashParams, 'state'),
      };
    }
  } catch {
    // Not a URL; the caller may have pasted a bare code or query string.
  }
  return null;
}

function readOAuthParamsFromQuery(raw: string): { code: string | null; state: string | null } | null {
  const queryStart = raw.indexOf('?');
  const fragmentStart = raw.indexOf('#');
  const queryLike = queryStart >= 0
    ? raw.slice(queryStart + 1, fragmentStart >= 0 ? fragmentStart : undefined)
    : raw.replace(/^[?#]/, '');
  if (!/(^|[&\s])(code|authorization_code|state)=/.test(queryLike)) return null;
  const params = new URLSearchParams(queryLike.replace(/\s+/g, '&'));
  return {
    code: readOAuthParam(params, 'code') ?? readOAuthParam(params, 'authorization_code'),
    state: readOAuthParam(params, 'state'),
  };
}

function extractOAuthStateFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return readOAuthParamsFromUrl(raw)?.state ?? readOAuthParamsFromQuery(raw)?.state ?? null;
}

export function parseClaudeOAuthCallbackInput(
  input: string,
  fallbackStateUrl?: string | null,
): { authorizationCode: string; state: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('请输入 Claude 登录授权码。');
  }

  const parsed = readOAuthParamsFromUrl(trimmed) ?? readOAuthParamsFromQuery(trimmed);
  const authorizationCode = parsed ? parsed.code : trimmed;
  const state = parsed?.state ?? extractOAuthStateFromUrl(fallbackStateUrl);

  if (!authorizationCode?.trim()) {
    throw new Error('Claude 登录授权码为空，请重新粘贴。');
  }
  if (!state) {
    throw new Error('缺少 Claude 登录 state，请重新发起登录。');
  }

  return { authorizationCode: authorizationCode.trim(), state };
}
