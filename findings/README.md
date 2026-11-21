# Findings, one file per page or strand

Each file here holds the full tables for one page or one strand of work. [../FINDINGS.md](../FINDINGS.md) holds what applies across them: the labels, the index by API area, the Chromium bugs, the API requests and the summary.

## Adding results

- A new page gets a new file named after it: `/fold/` is recorded in `findings/fold.md`. A pull request that adds a page adds this file and does not edit `FINDINGS.md` or any other file in this folder.
- More results for a page or strand that already has a file go in that file. A strand is worked on by one thread at a time, so its file has one writer.
- Do not add a list of the files to this README or anywhere else. The folder listing is the list.

## What a file holds

1. A `#` title that names the subject and its pages or libraries, for example ``# Text selection (`/selection/`, `lib/selection-fx.js`)``.
2. One line that says which browser produced the results and on what date, using the labels and browser names defined in `FINDINGS.md` ("measured", "reported", "inferred", "not verified"; C157, C153, A159).
3. The tables: experiment or question, result, reason.
4. "Things that bit": what cost time and how it was solved.
5. "Not verified": what was not run, and what would verify it.
6. Optional, at the end: "For the index" (one line for each result that belongs in the index by API area in `FINDINGS.md`, with its area), "Chromium bugs" and "API requests". A documentation pass copies these into `FINDINGS.md`. A page pull request does not.
