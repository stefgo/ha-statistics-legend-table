<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Fixed

- The first click on a legend row after loading the page greyed out the row but left its
  series in the chart; only a second click hid it. This happened with a `chart` link
  whenever the embedded card had rebuilt its chart after the legend first found it — while
  loading its data, for example. The legend now notices the replaced chart, and a click
  always acts on the one that is on screen.

### Releases

Releases are now produced by the release workflow all stefgo projects share. A version can
be tried as a beta before it is released, and every release is described here by hand, above
the list of commits.
