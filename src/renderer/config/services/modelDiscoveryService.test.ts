import { describe, expect, it } from 'vitest';
import { parseModelsResponse } from './modelDiscoveryService';

describe('model catalog response boundary', () => {
  it.each([
    undefined, null, 'upstream error', {}, { error: { message: 'rejected' } },
    { data: null }, { models: [{ name: 'unsupported-envelope' }] },
    { data: [{ name: 'missing-id' }] },
  ])('does not present a malformed or error response as an empty catalog: %j', body => {
    expect(() => parseModelsResponse(body)).toThrow(/model list/i);
  });

  it('accepts a genuinely empty OpenAI/Anthropic-compatible catalog', () => {
    expect(parseModelsResponse({ object: 'list', data: [] })).toEqual([]);
    expect(parseModelsResponse({ data: [], has_more: false })).toEqual([]);
  });

  it('parses each model independently instead of letting a malformed first row hide the list', () => {
    expect(parseModelsResponse({ data: [null, { name: 'invalid' }, { id: 'valid-model' }] }))
      .toEqual([expect.objectContaining({ id: 'valid-model' })]);
  });

  it.each([
    { input_modalities: {} },
    { input_modalities: 42 },
    { architecture: { input_modalities: true } },
  ])('keeps the catalog usable when a model has malformed optional capability fields: %j', metadata => {
    const models = parseModelsResponse({ data: [{ id: 'bad-metadata', ...metadata }, { id: 'valid-model' }] });
    expect(models.map(model => model.id)).toEqual(['bad-metadata', 'valid-model']);
    expect(models[0].supportsImage).toBeUndefined();
  });

  it('does not expose invalid optional display or token-limit values to the model UI/config', () => {
    const [model] = parseModelsResponse({ data: [{
      id: 'valid-model', display_name: {}, name: 'Fallback name', owned_by: [], status: {},
      token_limits: { context_window: 'not-a-number', max_output_token_length: {} },
      top_provider: { max_completion_tokens: [] },
    }] });
    expect(model).toMatchObject({ id: 'valid-model', displayName: 'Fallback name' });
    expect(model.ownedBy).toBeUndefined();
    expect(model.status).toBeUndefined();
    expect(model.contextLength).toBeUndefined();
    expect(model.maxOutputTokens).toBeUndefined();
  });

  it('preserves existing capability mapping and excludes shut-down models', () => {
    expect(parseModelsResponse({ data: [
      { id: 'retired', status: 'Shutdown' },
      { id: 'current', display_name: 'Current', max_input_tokens: 200000, max_tokens: 8192 },
    ] })).toEqual([expect.objectContaining({
      id: 'current', displayName: 'Current', contextLength: 200000, maxOutputTokens: 8192,
    })]);
    expect(parseModelsResponse({ data: [{ id: 'retired', status: 'Shutdown' }] })).toEqual([]);
  });
});
