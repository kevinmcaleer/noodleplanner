/**
 * staticUrl(path) -- the deploy-hash form of a /static/ URL.
 *
 * Templates version what they load with ?v=<hash>, and an import map versions
 * every module import, but neither reaches a URL a script hands to the
 * browser itself: new Worker(), fetch(), a created <script>. Those go through
 * here so a deploy can never leave one pointing at a stale cached file.
 * The page sets window.NP_STATIC_V; without it (node tests, Storybook) the
 * path comes back unchanged.
 */
export function staticUrl(path) {
  const v = globalThis.NP_STATIC_V;
  if (!v || path.includes('?')) return path;
  return `${path}?v=${v}`;
}
