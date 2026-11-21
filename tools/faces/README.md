# Preset faces

Every real player and coach wears a saved pocket-faces face: `cfb_sim_data/faces/<team>.json`.

- `players` (by slug) and `coaches` (by name): chosen by looking at the person's team-site or ESPN headshot.
- `rolled`: rolled once and saved for people with no photo (most are names the roster source invented). `python3 tools/faces/roll.py` fills in anyone without a face; `--redo` rolls them all again.
- `name_corrections.json`: players whose name in the game differs from the name on his real roster (a nickname, a short form or a misspelling), with where the real one was seen. The game's names were not changed.
- `missing_features.json`: what each photo showed that the face parts cannot draw yet (gray hair, glasses, braids, earrings...), with a tally. Use it to choose what art to add and whom to update after.

`pipeline/` holds the scripts and briefs as they were run to make the faces (roster pages and ESPN to photo sheets, a person's read of each sheet to a table of parts, tables to these files). They were written for one run from a scratch folder: the work-folder paths inside them need changing before a rerun, and the photos themselves were not kept.
