# ICML 2027 example paper

A realistic two-column conference paper (bibliography, figure, algorithms,
cross-references) for testing MyLeaf by hand. `pnpm dev` loads it as the
project "ICML 2027 example" when no project of that name exists; see
`apps/server/src/sample-project.ts`. This README is not part of the project.

Only the files needed to compile are here; the prebuilt `example_paper.pdf`
from the original kit is left out.

## Origin and licences

These files are third-party and are not covered by MyLeaf's AGPL licence.

| File                                                                           | Origin                                      | Licence                          |
| ------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| `example_paper.tex`, `example_paper.bib`, `icml2027.sty`, `icml_numpapers.pdf` | ICML 2027 author kit                        | None stated                      |
| `icml2027.bst`                                                                 | ICML author kit, derived from `plainnl.bst` | None stated                      |
| `fancyhdr.sty`                                                                 | fancyhdr package, bundled with the kit      | LaTeX Project Public License 1.3 |
| `algorithm.sty`, `algorithmic.sty`                                             | © 1994 Peter Williams, bundled with the kit | None stated in the files         |
