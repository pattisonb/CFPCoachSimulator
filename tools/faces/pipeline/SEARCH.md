# Finding a photo for people the roster pages did not cover

A football game draws each real player and coach as a small pixel face modelled on a photo. The people in your list had
no photo on the sources tried so far (team roster page, ESPN roster). Find one usable photo of each, then describe
the faces exactly as `BRIEF.md` (same directory as this file) says. Read `BRIEF.md` first.

Work dir: `W=/tmp/claude-0/-home-user-CFPCoachSimulator/cff90bb8-6355-5fad-b7f0-2367a0e9e7c7/scratchpad/faces`
Your folder: `$W/teams/<folder>/` (given to you). It holds `todo.json`: a list of `{id, name, role or pos, team}`.

## Finding the photo
- Search the web for the person **in a football context**: name + school + "football" (+ "coach" for coaches). Load the
  WebSearch / WebFetch tools with ToolSearch if they are not already available; `curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"` also works for most pages.
- Good sources: the school's athletics site (staff directory or player bio, including a previous school's), Wikipedia /
  Wikimedia Commons, ESPN, 247Sports, On3, conference sites, local news stories about that person.
- Only accept a photo when the page ties it to this person in football (name plus school, team or a previous team
  named in the search results for him). A same-named person with no football link is NOT acceptable: leave him out.
  If two candidates are plausible and you cannot tell which is right, leave him out.
- You need a direct image URL (jpg/png/webp) where the face is reasonably clear and facing the camera. A head-and-shoulders
  portrait is best. Do not spend more than three or four tool calls on one person; if nothing turns up, move on.
- If a site refuses the request (403, a bot check), do not try to get around it; use another source.

## Then
1. Write `people.json` in your folder: a JSON list of `{"id": ..., "name": ..., "pos": <role or pos>, "img": "<direct image url>", "source": "<page url>"}`
   for the people you found (copy `id` exactly from `todo.json`).
2. Run `python3 $W/code/download.py $W <folder>`: it downloads each image and builds `sheets/NN.jpg`. It crops the top-centre
   square, so check the sheets; a tile where the face is cut off, tiny, or missing gets `SKIP` in the table.
3. Follow BRIEF.md steps 2-4 for your folder (Read the sheets, write `table.txt`, run `finalize.py` until it prints `OK`).
4. Write `notfound.json`: a JSON list of the ids you could not find a football-context photo for.

## Report back
`<folder>: OK n players, n coaches, n skipped; found F of T; not found: <names>` and one line on which sources worked best.
