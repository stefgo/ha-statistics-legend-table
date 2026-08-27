#!/bin/bash
# Prints the CHANGELOG.md section of one version, as the body of a GitHub release.
#
# Used by .github/workflows/release.yml, and by hand to fix up an existing
# release:
#
#   gh release edit v0.5.1 --notes-file <(scripts/release-notes.sh 0.5.1)
#
# Takes the version with or without the leading "v". Fails when the CHANGELOG
# has no section for it, so a release never goes out with an empty body.

set -e

VERSION="${1#v}"

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# Everything between this version's heading and the next one, with the heading
# itself dropped — GitHub already shows the version as the release title.
NOTES="$(awk -v v="$VERSION" '
  $0 ~ "^## \\[" v "\\]"  { inside = 1; next }
  inside && /^## \[/      { exit }
  # The oldest section is followed by the link definitions, which close the
  # file rather than the section — they must not end up in the release body.
  inside && /^\[[^]]+\]: / { exit }
  inside                  { print }
' CHANGELOG.md)"

# Trim leading and trailing blank lines.
NOTES="$(printf '%s\n' "$NOTES" | sed -e '/./,$!d' -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"

if [ -z "$NOTES" ]; then
  echo "CHANGELOG.md has no section for version ${VERSION}" >&2
  exit 1
fi

printf '%s\n' "$NOTES"

# The compare link the CHANGELOG keeps for this version, as the closing line.
COMPARE="$(grep -m1 "^\[${VERSION}\]: " CHANGELOG.md | sed "s/^\[${VERSION}\]: //")"
if [ -n "$COMPARE" ]; then
  printf '\n**Full changelog**: %s\n' "$COMPARE"
fi
