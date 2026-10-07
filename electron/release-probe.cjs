function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(String(value || ""));
    return match ? { parts: match.slice(1, 4).map(Number), prerelease: Boolean(match[4]) } : null;
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    if (a.parts[index] !== b.parts[index]) return Math.sign(a.parts[index] - b.parts[index]);
  }
  return Number(b.prerelease) - Number(a.prerelease);
}

async function probePublishedRelease(currentVersion, request = fetch) {
  try {
    const url = `https://api.github.com/repos/coryfail/AssistedWriter/releases?per_page=10&t=${Date.now()}`;
    const response = await request(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AssistedWriter-Updater",
        "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const releases = await response.json();
    if (!Array.isArray(releases)) return null;
    const versions = releases.filter((release) => !release.draft && !release.prerelease &&
      release.assets?.some((asset) => asset.name === "latest-mac.yml"))
      .map((release) => String(release.tag_name || "").replace(/^v/, ""))
      .filter((version) => compareVersions(version, currentVersion) === 1);
    return versions.sort((a, b) => compareVersions(b, a) || 0)[0] || null;
  } catch {
    return null;
  }
}

module.exports = { compareVersions, probePublishedRelease };
