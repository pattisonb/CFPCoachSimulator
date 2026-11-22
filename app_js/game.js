// The whole game for a host (the browser's worker, a Node script): every module loaded and registered, and the few
// things a host sets before it calls the API:
//   - how files are read and written: `files.set_reader(fn)` and `files.set_store({write, exists, remove, remove_dir,
//     list, mtime})` (engine_js/files.js), paths from the project's root;
//   - gzip for a career's save file: `career.zip = { gzip(bytes), gunzip(bytes, most) }`;
//   - optionally `season.play_jobs`, to share a week's games out to helpers.
// Custom coaches are files like the rest (data/coaches/<id>.json), through the file store.
import * as files from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { api as engine } from "../engine_js/api.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { ratings } from "../teamdata_js/ratings.js";
import { shown } from "../teamdata_js/shown.js";
import "../teamdata_js/build_teams.js";
import * as game_job from "../sim_js/game_job.js";
import "../sim_js/polls.js";
import "../sim_js/awards.js";
import "../sim_js/bowls.js";
import "../sim_js/teamnames.js";
import "../sim_js/fcs_names.js";
import { coaches } from "../sim_js/coaches.js";
import "../sim_js/form.js";
import "../sim_js/grade.js";
import "../sim_js/news.js";
import "../sim_js/schedule_gen.js";
import { season } from "../sim_js/season.js";
import { position_fit } from "../career_js/position_fit.js";
import "../career_js/recruits.js";
import "../career_js/clear.js";
import "../career_js/grades.js";
import "../career_js/word.js";
import "../career_js/promises.js";
import "../career_js/ability_goals.js";
import "../career_js/league.js";
import "../career_js/coach_names.js";
import "../career_js/programs.js";
import "../career_js/carousel.js";
import "../career_js/persona.js";
import "../career_js/scenes.js";
import "../career_js/prospects.js";
import "../career_js/headquarters.js";
import "../career_js/office.js";
import "../career_js/league_fill.js";
import "../career_js/league_file.js";
import { career } from "../career_js/career.js";
import { recruiting } from "../career_js/recruiting.js";
import { offseason } from "../career_js/offseason.js";
import { api } from "./api.js";

// the modules written before a port registered itself
const early = { game_scale, ratings, shown, position_fit, game_job };
for (const [name, ns] of Object.entries(early)) modules[name] = ns;
// an old save's recruits are brought onto the game's scale with recruiting's own reads (teamdata_js/game_scale.js upgrade)
game_scale.modules.recruiting = recruiting;

// a custom coach is a file: data/coaches/<id>.json
coaches.store = {
  read: (id) => (files.exists(coaches._path(id)) ? files.read_text(coaches._path(id)) : null),
  write: (id, text) => files.write_text(coaches._path(id), text),
  remove: (id) => files.remove(coaches._path(id)),
  list: () => files.list_dir(coaches.COACHES_DIR).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)),
};

export { api, engine, files, modules, season, recruiting, offseason, career, coaches };
