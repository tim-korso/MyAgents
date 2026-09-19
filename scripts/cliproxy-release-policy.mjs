// Required context: specs/tech_docs/managed_cliproxy.md. Keep selection parity
// with src-tauri/src/cliproxy_policy.rs; App version bumps do not edit releases.
export function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Expected a numeric x.y.z version');
  const parts = value.split('.').map(BigInt);
  if (parts.some(part => part > 18446744073709551615n)) throw new Error('Version component overflow');
  return parts;
}
export function compareVersions(a, b) {
  const left = version(a); const right = version(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function validateReleases(releases) {
  if (!Array.isArray(releases) || !releases.length) throw new Error('Release policies are required');
  const seen = new Set();
  for (const release of releases) {
    const minimum = release.compatibility?.minAppVersion;
    version(minimum); version(release.version);
    if (seen.has(minimum)) throw new Error('Duplicate minimum App version');
    seen.add(minimum);
    if ('appVersions' in release.compatibility || 'sdkVersion' in release.compatibility
      || !Number.isSafeInteger(release.compatibility.revision) || release.compatibility.revision <= 0) {
      throw new Error('Invalid release compatibility policy');
    }
  }
}
export function selectRelease(releases, appVersion) {
  validateReleases(releases); version(appVersion);
  return releases.filter(r => compareVersions(r.compatibility.minAppVersion, appVersion) <= 0)
    .sort((a, b) => compareVersions(b.compatibility.minAppVersion, a.compatibility.minAppVersion))[0];
}
export function selectBundledRelease(releases, appVersion, source) {
  validateReleases(releases);
  const pinned = releases.filter(r => r.version === source.version && r.commit === source.commit);
  if (!pinned.length) throw new Error('Signed catalogue does not contain the bundled source lock');
  const selected = selectRelease(pinned, appVersion);
  if (!selected) throw new Error('App is below the bundled component minimum version');
  return selected;
}
export function mergeReleases(previous, incoming) {
  validateReleases(previous); validateReleases(incoming);
  const replacements = new Set(incoming.map(r => r.compatibility.minAppVersion));
  return [...previous.filter(r => !replacements.has(r.compatibility.minAppVersion)), ...incoming]
    .sort((a, b) => compareVersions(a.compatibility.minAppVersion, b.compatibility.minAppVersion));
}
