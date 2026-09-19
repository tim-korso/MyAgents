import { describe, expect, it } from 'vitest';
import { parseClaudeOAuthCallbackInput } from './subscription-auth-parser';

describe('Claude subscription OAuth callback input parsing', () => {
  const manualUrl = 'https://claude.com/cai/oauth/authorize?code=true&state=state-from-start&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback';

  it('accepts the full callback URL copied from the browser', () => {
    expect(parseClaudeOAuthCallbackInput(
      'https://platform.claude.com/oauth/code/callback?code=auth-code-1&state=state-from-callback',
      manualUrl,
    )).toEqual({
      authorizationCode: 'auth-code-1',
      state: 'state-from-callback',
    });
  });

  it('accepts query-string shaped callback text', () => {
    expect(parseClaudeOAuthCallbackInput(
      'code=auth-code-2&state=state-from-query',
      manualUrl,
    )).toEqual({
      authorizationCode: 'auth-code-2',
      state: 'state-from-query',
    });
  });

  it('accepts a bare authorization code using the active manual URL state', () => {
    expect(parseClaudeOAuthCallbackInput('auth-code-3', manualUrl)).toEqual({
      authorizationCode: 'auth-code-3',
      state: 'state-from-start',
    });
  });

  it('accepts a bare authorization code using the active automatic callback URL state', () => {
    expect(parseClaudeOAuthCallbackInput(
      'auth-code-automatic',
      'http://localhost:32145/callback?state=state-from-automatic',
    )).toEqual({
      authorizationCode: 'auth-code-automatic',
      state: 'state-from-automatic',
    });
  });

  it('rejects a bare authorization code when no active OAuth state is available', () => {
    expect(() => parseClaudeOAuthCallbackInput('auth-code-4')).toThrow('缺少 Claude 登录 state');
  });

  it('rejects callback-shaped text without an authorization code', () => {
    expect(() => parseClaudeOAuthCallbackInput('state=state-without-code', manualUrl))
      .toThrow('Claude 登录授权码为空');
  });
});
