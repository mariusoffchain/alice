# Evaluating Alice's retrieval and answers

Alice answers Bitcoin questions from a fixed corpus of notes. Before a change to
retrieval or to the way answers are framed reaches a release, it is measured on
frozen question sets, with a local model and with the Private Cloud model. This
page describes the sets, what is measured, the results that stand behind 0.2.2
and how to replay them.

## Question sets

The sets live in `scripts/data/rag-query-eval/` and do not change once used:

- **Development set, 44 questions** (`generation-development-44-2026-10-04.json`):
  the questions used while working on a change. Numbers on this set guide the
  work and are not quoted as results.
- **Acceptance set, 40 questions** (`generation-acceptance-40-2026-10-05.json`):
  French and English questions never used during development. Each one names
  the note that must be in the model's context and carries the review policy
  that applies to its answer.
- **Retrieval acceptance set** (`retrieval-acceptance-40-2026-10-06.json`): the
  same 40 subjects, expressed as the note that must be retrieved for each
  question.
- `questions.json`, `generation-development-42-2026-10-04.json` and the two
  `baseline-*.ts` files are the fixtures of the automated tests and of the
  retrieval scripts.

## What is measured

**Retrieval.** For every question, whether the expected note is among the notes
handed to the model. The retrieval report also records recall and mean
reciprocal rank over the set.

**Answers.** Every answer receives one of three verdicts, pass, partial or fail,
and a critical flag when it states something false about money, keys or
recovery. The verdicts come from a reviewer model applying one fixed prompt and
the policy recorded in the fixture. They are a consistent measure of the same
answers over time, not a human audit, and the full answers ship with the
evidence so anyone can read them.

## Results behind 0.2.2

Local model: Qwen3.5 9B, Q4_K_M quantisation, balanced preset, with the
production pedagogy settings, served by llama.cpp. The same question produces
the same answer on the same machine, so differences between two runs come from
the change under test.

| Run on the acceptance set, 40 questions | Expected note in context | Pass | Partial | Fail | Critical |
| --- | --- | --- | --- | --- | --- |
| Before the repairs (2026-10-05) | 25 / 40 | 3 | 22 | 15 | 6 |
| After the retrieval repair (2026-10-06) | 40 / 40 | 8 | 21 | 11 | 5 |
| After the answer rules (2026-10-06) | 40 / 40 | 11 | 23 | 6 | 0 |

The retrieval repair lets the statement that precedes a question reach
retrieval, recognises more question openings in French and English, adds
missing keywords to seven notes and stops product documentation from crowding
out a note on a shared common word. The answer rules give the model, for the
Ark, multisig and replace-by-fee notes, the points an answer must state and the
claims it must not make, and check the answer afterwards.

The Private Cloud model was measured on the same sets before these two changes:
36 answers on the development set gave 17 pass, 15 partial, 4 fail and
2 critical; the acceptance set gave 12 pass, 15 partial, 13 fail and 7 critical.
It has not been measured again since, and the figures above describe the local
model only.

## Replaying a run

Serve the model with llama.cpp, then run the harness against the acceptance set
and verify that the prompt template the server applied is the expected one:

```bash
llama-server -m <path to Qwen3.5-9B-Q4_K_M.gguf> --host 127.0.0.1 --port 18083 --no-webui --ctx-size 8192 --parallel 1 -t 4 --jinja
```

```bash
node scripts/eval-rag-generation.mjs --fixture scripts/data/rag-query-eval/generation-acceptance-40-2026-10-05.json --output <results file> --model qwen3.5-9b --model-file <path to the GGUF file> --preset balanced --production-pedagogy --learn-root apps/app-web/public/learn
```

```bash
node scripts/verify-generation-template.mjs --report <results file> --output <template file>
```

The retrieval report is produced by `scripts/eval-rag-production.mjs` with the
retrieval acceptance set as its fixture. The Learn packs under
`apps/app-web/public/learn` are built, not tracked; see `BUILDING.md`.

## Evidence files

The repository keeps the question sets and the test fixtures. The complete
outputs of every run (answers, prompts sent, reviewer verdicts, about 41 MB)
are not tracked, to keep the clone small; they are attached, as a 5 MB archive, to the GitHub
release as `alice-0.2.2-rag-evidence.zip`, SHA-256
`6492f34fc8e1db8089e769ccae2f0cedbf1d62ca57f9b4f0f1cd75cfb92469f5`.

Files in the repository:

| File | SHA-256 |
| --- | --- |
| `questions.json` | `5f823a767ac8317224d7fb3f9434ef91efc89f923ebe203a97370fb238636b73` |
| `baseline-planner.ts` | `ffffdbb0c40099a6e9084f08feddb2a1ebff8b5eb4acf3b721082fe1d1d016fe` |
| `baseline-rewrite.ts` | `0eff540a5f7cafd53d9425f256b4f9eda0fd1cbd99ce366c942e0266c4978d76` |
| `generation-development-42-2026-10-04.json` | `27be24036bf6ff83ae9d95a0d8adbaa066e0e2199e7dc7fb2b3df0dd11af37b9` |
| `generation-development-44-2026-10-04.json` | `737b33b81d1541c5eb43686492fe79a2941648d25a23ed801d382c8c68abb9e3` |
| `generation-acceptance-40-2026-10-05.json` | `34fa2a1cae195943dec5790791720ed9086dfe75a0a859132d285c0cf4b907af` |
| `retrieval-acceptance-40-2026-10-06.json` | `ac52134e251077a8053dd4c6e9edcc94d01275cac6777c38c59a40dfa953cc00` |
| `retrieval-acceptance-40-report-2026-10-06.json` | `e601ccfdd199dd6ef1e00df0fa216ecbd9a68d5db5632336ca7d7493ea81577e` |

Files in the archive that carry the results quoted above:

| Run | File | SHA-256 |
| --- | --- | --- |
| Qwen3.5 9B, acceptance set, before the repairs | `generation-repaired-qwen35-9b-acc40-results-2026-10-05.json` | `e00d3f829bbb0a79c57092f02cdeb9d4374764a7ee86205e7a8b31bc54c9c17c` |
| | `generation-repaired-qwen35-9b-acc40-review-2026-10-05.json` | `4ffa02f244af9aff4958c9a9ec0d7a17fa0ae2189dfba4c1786d5de7e929bd31` |
| Qwen3.5 9B, acceptance set, after the retrieval repair | `generation-retrieval-repair-qwen35-9b-acc40-results-2026-10-06.json` | `342891b6fe545455a9f5affe5ae0bb7db7875b0013d2a9178ea421a61e85e69f` |
| | `generation-retrieval-repair-qwen35-9b-acc40-review-2026-10-06.json` | `370858cd979e27bcf1dd747618ab99dbfec0f6d8bd12124939f41f6941a3d2fb` |
| Qwen3.5 9B, acceptance set, after the answer rules | `generation-answer-rules-qwen35-9b-acc40-results-2026-10-06.json` | `d0ab139ad3bd2d42dd9ccb579b8f6d1346a3e48f695e2f69253564ea33e9a6da` |
| | `generation-answer-rules-qwen35-9b-acc40-review-2026-10-06.json` | `a7b9431dc9bb097c05d801c3bb83d29eecbe910b90684b93aaa25b4cb2bb0e4b` |
| Private Cloud, development set | `generation-private-cloud-answers-2026-10-05.json` | `c3c1629d19ba22ff5826b5ea204c861980a8e13305660a4f2123c7e0404af268` |
| | `generation-private-cloud-dev44-review-2026-10-05.json` | `fefbeaed1c1f9ac8ef192ff1ed9d5514c4646926e6df9731b74813150ea22d17` |
| Private Cloud, acceptance set | `generation-private-cloud-acc40-answers-2026-10-05.json` | `3f96fbd29a7e53122898530912a7eec4ac25f23c3e6fa336aeb0277b61d1ca8c` |
| | `generation-private-cloud-acc40-review-2026-10-06.json` | `821f63c333a53c39758f89f4de972bbe1f2dd2267c9c1110b4c95bda046c443c` |
