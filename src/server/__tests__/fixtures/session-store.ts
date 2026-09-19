import { createSessionMetadata } from '../../types/session';
import type * as SessionStore from '../../SessionStore';

/** Historical files must remain V1 fixtures after the production default
 * changes. This is test seeding, not an application format-selection API. */
export async function createLegacySession(store: typeof SessionStore, ...args: Parameters<typeof SessionStore.createSession>) {
  const metadata = createSessionMetadata(...args);
  delete metadata.transcriptFormat;
  await store.saveSessionMetadata(metadata);
  return metadata;
}

/** Represents a Session already published to the global history index. */
export async function createPublishedSession(store: typeof SessionStore, ...args: Parameters<typeof SessionStore.createSession>) {
  const metadata = await store.createSession(...args);
  if (!await store.publishSessionForHandoff(metadata.id)) throw new Error('Fixture could not publish V2 birth');
  return store.getSessionMetadata(metadata.id)!;
}
