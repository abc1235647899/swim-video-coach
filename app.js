(function () {
  const KEY = "swim-video-coach-v1";
  const KB = window.SWIM_KB;
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $("#app");
  const steps = $("#steps");

  const state = load() || { profiles: [], suggestions: [], logs: [] };
  if (!state.watchProgress) state.watchProgress = {};
  let currentId = state.profiles[0]?.id || null;
  let view = "roster";
  let draftNeeds = null;
  let lastSetId = null;
  let ytPlayers = [];
  let watchTimer = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || ""); }
    catch { return null; }
  }
  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function current() { return state.profiles.find((p) => p.id === currentId) || null; }

  function go(next) {
    view = next;
    render();
  }

  steps.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.view !== "roster" && !current()) return;
    go(btn.dataset.view);
  });

  const NEED_TO_TAGS = {
    start: ["start_reaction", "block_setup", "backstroke_start"],
    underwater: ["underwater_dolphin_kick", "streamline", "15m_rule", "late_breakout"],
    turns: ["IM_turns", "streamline"],
    midrace: ["race_pacing", "breathing_pattern", "head_position", "mid_distance_freestyle"],
    finish: ["sprint_finish", "touch"],
    stroke: ["high_elbow_catch", "freestyle_pull", "butterfly_kick_timing", "breaststroke_kick", "breaststroke_pulldown"]
  };

  function suggestFor(profile, needs) {
    const already = new Set(
      state.suggestions
        .filter((s) => s.athleteId === profile.id)
        .flatMap((s) => s.videos)
    );
    const needTags = new Set([
      ...(needs?.tags || []),
      ...(NEED_TO_TAGS[needs?.when] || []),
      ...(profile.weaknesses || [])
    ]);
    const stroke = (profile.stroke || "").toLowerCase();
    const level = (profile.level || "").toLowerCase();
    const age = (profile.ageBand || "").toLowerCase();

    function logBoost(videoId) {
      const rows = KB.sampleLogs.filter((r) => r.video_id === videoId);
      let score = 0;
      for (const r of rows) {
        const p = KB.sampleProfiles.find((x) => x.athlete_id === r.athlete_id);
        const similar =
          p &&
          ((p.primary_stroke || "").toLowerCase() === stroke ||
            (p.level || "").toLowerCase() === level);
        if (!similar) continue;
        if (r.performance_change === "improved" && (r.completion_pct || 0) >= 80) score += 3;
        else if (r.performance_change === "mixed or unclear") score += 0.5;
        else if (String(r.performance_change).includes("no clear") || String(r.performance_change).includes("not assessable")) score -= 1;
      }
      return score;
    }

    const scored = KB.catalog.map((v) => {
      let score = 0;
      const reasons = [];
      const strokeOk = v.stroke_fit.some((s) => s === "all strokes" || s.toLowerCase() === stroke || (stroke && s.toLowerCase().includes(stroke)));
      const levelOk = v.level_fit.some((s) => s.toLowerCase() === level || s.toLowerCase() === age);
      if (strokeOk) { score += 3; reasons.push("Fits " + (profile.stroke || "this stroke")); }
      else score -= 4;
      if (levelOk) score += 1;
      const overlap = v.topic_tags.filter((t) => needTags.has(t));
      if (overlap.length) {
        score += overlap.length * 2;
        reasons.push("Matches the priority need: " + overlap.join(", ").replaceAll("_", " "));
      }
      const boost = logBoost(v.video_id);
      if (boost > 0) {
        score += boost;
        reasons.push("Similar illustrative profiles later improved after watching this");
      }
      if (already.has(v.video_id)) {
        score -= 2;
        reasons.push("Already suggested to this swimmer before");
      }
      if (needs?.time === "short" && v.duration_sec > 480) score -= 1;
      if (needs?.time === "dryland" && v.topic_tags.includes("dryland")) {
        score += 2;
        reasons.push("You said you can also do dryland work");
      }
      return { video: v, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);
    const picked = scored.filter((x) => x.score > 0).slice(0, 5);
    return (picked.length ? picked : scored.slice(0, 3)).map((x) => ({
      videoId: x.video.video_id,
      reason: x.reasons.slice(0, 2).join(". ") || "Best available match in this small catalogue."
    }));
  }

  function needSummary(profile, needs) {
    const whenMap = {
      start: "the start and block work",
      underwater: "the underwater and breakout",
      turns: "turns and the first strokes off the wall",
      midrace: "mid-race pacing and breathing",
      finish: "the last ten metres and the touch",
      stroke: "stroke pattern and timing"
    };
    const when = whenMap[needs.when] || "a general technical gap";
    return `${profile.name} looks to need the most help with ${when}. The catalogue below is a short set, not the whole library, and a coach should still watch the swimmer in the water before locking this in.`;
  }

  function videoById(id) { return KB.catalog.find((v) => v.video_id === id); }

  function youtubeUrl(v) {
    if (v?.youtube_id) return "https://www.youtube.com/watch?v=" + v.youtube_id;
    if (v?.youtube_search) return "https://www.youtube.com/results?search_query=" + encodeURIComponent(v.youtube_search);
    return "";
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function loadYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (window._ytApiReady) return window._ytApiReady;
    window._ytApiReady = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") prev();
        resolve();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      if (window.YT && window.YT.Player) resolve();
    });
    return window._ytApiReady;
  }

  function destroyPlayers() {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
    for (const player of ytPlayers) {
      try { player.destroy(); } catch { /* already gone */ }
    }
    ytPlayers = [];
  }

  function recordWatch(videoId, seconds, duration) {
    const prev = state.watchProgress[videoId] || { seconds: 0, duration: 0 };
    const next = {
      seconds: Math.max(prev.seconds || 0, Math.floor(Number(seconds) || 0)),
      duration: Number(duration) || prev.duration || 0
    };
    state.watchProgress[videoId] = next;
    save();
    return next;
  }

  function watchedFor(videoId, fallbackDuration) {
    const w = state.watchProgress[videoId] || {};
    const duration = w.duration || fallbackDuration || 0;
    const seconds = w.seconds || 0;
    const pct = duration ? Math.min(100, Math.round(seconds / duration * 100)) : 0;
    return { seconds, duration, pct };
  }

  function updateWatchMeter(videoId) {
    const el = document.querySelector(`[data-watch-meter="${videoId}"]`);
    if (!el) return;
    const v = videoById(videoId);
    const rec = watchedFor(videoId, v?.duration_sec);
    if (!rec.seconds) {
      el.textContent = rec.duration
        ? "Not watched yet in this browser · " + fmtTime(rec.duration)
        : "Not watched yet in this browser";
      return;
    }
    el.textContent = "Watched " + fmtTime(rec.seconds) +
      (rec.duration ? " of " + fmtTime(rec.duration) : "") +
      " (" + rec.pct + "%)";
  }

  function bindYtPlayers(ids) {
    const mountable = ids.filter((id) => videoById(id)?.youtube_id);
    if (!mountable.length) return;
    const startPoll = () => {
      if (watchTimer) return;
      watchTimer = setInterval(() => {
        for (const player of ytPlayers) {
          const vid = player._catalogId;
          try {
            if (typeof player.getCurrentTime !== "function") continue;
            const seconds = player.getCurrentTime();
            const duration = player.getDuration && player.getDuration();
            if (seconds > 0 || duration > 0) {
              recordWatch(vid, seconds, duration);
              updateWatchMeter(vid);
            }
          } catch { /* player not ready */ }
        }
      }, 1000);
    };
    loadYtApi().then(() => {
      if (view !== "suggest" && view !== "log") return;
      for (const id of mountable) {
        const slot = document.getElementById("yt-" + id);
        if (!slot || !window.YT || !window.YT.Player) continue;
        const v = videoById(id);
        const player = new window.YT.Player(slot, {
          videoId: v.youtube_id,
          host: "https://www.youtube.com",
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
          events: {
            onReady(ev) {
              try {
                const d = ev.target.getDuration && ev.target.getDuration();
                if (d) {
                  recordWatch(id, state.watchProgress[id]?.seconds || 0, d);
                  updateWatchMeter(id);
                }
              } catch { /* ignore */ }
            },
            onStateChange(ev) {
              try {
                const seconds = ev.target.getCurrentTime && ev.target.getCurrentTime();
                const duration = ev.target.getDuration && ev.target.getDuration();
                recordWatch(id, seconds, duration);
                updateWatchMeter(id);
              } catch { /* ignore */ }
              if (ev.data === window.YT.PlayerState.PLAYING) startPoll();
            }
          }
        });
        player._catalogId = id;
        ytPlayers.push(player);
      }
    }).catch(() => { /* file:// or blocked API; static iframe already in place */ });
  }

  function defaultDistanceM(profile, set) {
    if (set?.needs?.prep === "50") return 50;
    if (set?.needs?.prep === "100") return 100;
    if (set?.needs?.prep === "200" || set?.needs?.prep === "im") return 200;
    const m = String(profile?.events || "").match(/(\d{2,3})/);
    return m ? Number(m[1]) : 100;
  }

  function suggestedTest(profile, set) {
    const tags = new Set();
    for (const id of set.videos) {
      for (const t of videoById(id)?.topic_tags || []) tags.add(t);
    }
    const event = (profile.events || "").split(/[,;]/)[0].trim() || profile.stroke || "time trial";
    if (tags.has("underwater_dolphin_kick") || tags.has("streamline") || tags.has("15m_rule") || tags.has("late_breakout")) {
      return "recorded 25 m underwater + club " + event + " time trial";
    }
    if (tags.has("start_reaction") || tags.has("block_setup") || tags.has("backstroke_start")) {
      return "start + 15 m time";
    }
    if (tags.has("IM_turns") || tags.has("race_pacing")) {
      return "200 IM or IM transition-turn check";
    }
    if (tags.has("sprint_finish") || tags.has("touch")) {
      return "50 time trial with a focus on the finish and touch";
    }
    if (tags.has("breathing_pattern") || tags.has("head_position") || tags.has("mid_distance_freestyle")) {
      return "mid-distance freestyle set (for example 200) and a head-position check";
    }
    if (tags.has("breaststroke_pulldown") || tags.has("breaststroke_kick")) {
      return "50 or 100 breaststroke time trial, including the pulldown";
    }
    if (tags.has("butterfly_kick_timing")) return "50 butterfly timing check";
    if (tags.has("high_elbow_catch") || tags.has("freestyle_pull")) return "100 or 200 freestyle stroke check";
    if (tags.has("dryland")) return "dryland session note (no pool time trial required)";
    return "club " + event;
  }

  function autoFillDraft(profile, set, existing) {
    const watch = { ...(existing?.watch || {}) };
    const lines = [];
    let anyWatch = false;
    let high = 0;
    let low = 0;
    for (const id of set.videos) {
      const v = videoById(id);
      const rec = watchedFor(id, v?.duration_sec);
      const formSec = document.querySelector(`[data-watch-sec="${id}"]`)?.value || "";
      const bestSec = Math.max(rec.seconds || 0, Number(formSec) || 0);
      const duration = rec.duration || v?.duration_sec || 0;
      const pct = duration ? Math.min(100, Math.round(bestSec / duration * 100)) : (Number(document.querySelector(`[data-watch-pct="${id}"]`)?.value) || 0);
      if (bestSec > 0) {
        anyWatch = true;
        watch[id] = { seconds: bestSec, pct };
        if (pct >= 70) high += 1;
        else low += 1;
        lines.push((v?.title || id) + ": watched about " + bestSec + "s (" + pct + "%).");
      } else {
        low += 1;
        lines.push((v?.title || id) + ": no in-app watch time recorded yet.");
      }
    }
    const fillIfEmpty = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el || value == null || value === "") return;
      if (String(el.value || "").trim() === "") el.value = value;
    };
    for (const id of set.videos) {
      const w = watch[id];
      if (!w) continue;
      const sec = document.querySelector(`[data-watch-sec="${id}"]`);
      const pct = document.querySelector(`[data-watch-pct="${id}"]`);
      if (sec) sec.value = w.seconds;
      if (pct) pct.value = w.pct;
    }
    fillIfEmpty("#ltest", suggestedTest(profile, set));
    fillIfEmpty("#ldist", String(defaultDistanceM(profile, set)));
    const changeEl = document.querySelector("#lchange");
    if (changeEl && !existing?.change) {
      changeEl.value = (!anyWatch || (low && !high))
        ? "not assessable (low watch)"
        : "mixed or unclear";
    }
    const watchedTitles = set.videos
      .filter((id) => (watch[id]?.pct || 0) >= 50)
      .map((id) => videoById(id)?.title)
      .filter(Boolean);
    const thinTitles = set.videos
      .filter((id) => !((watch[id]?.seconds > 0) && (watch[id]?.pct || 0) >= 50))
      .map((id) => videoById(id)?.title)
      .filter(Boolean);
    const hasRule = set.videos.some((id) => videoById(id)?.topic_tags?.includes("15m_rule"));
    fillIfEmpty("#swot-s", watchedTitles.length ? "Watched and practised: " + watchedTitles.join("; ") : "");
    fillIfEmpty("#swot-w", thinTitles.length ? "Still thin watch or practice on: " + thinTitles.join("; ") : "");
    fillIfEmpty("#swot-o", "Follow-up test: " + suggestedTest(profile, set));
    fillIfEmpty("#swot-t", hasRule
      ? "A longer underwater is not always legal (15 m rule) or always faster."
      : "Do not treat a single session as a season-long change.");
    fillIfEmpty("#lnote", "Auto-filled from in-app watch data on " + today() + ". " + lines.join(" ") + " Time and heart rate still need a pool-side entry. A coach should confirm what happened in the water.");
    return { count: Object.keys(watch).length, anyWatch };
  }

  function videoCardMedia(v) {
    if (v.youtube_id) {
      const rec = watchedFor(v.video_id, v.duration_sec);
      const src = "https://www.youtube.com/embed/" + encodeURIComponent(v.youtube_id) + "?rel=0&enablejsapi=1";
      return `
        <div class="yt-wrap">
          <iframe id="yt-${esc(v.video_id)}" src="${src}" title="${esc(v.youtube_title || v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
        <p class="watch-meter" data-watch-meter="${esc(v.video_id)}">${rec.seconds ? "Watched " + fmtTime(rec.seconds) + (rec.duration ? " of " + fmtTime(rec.duration) : "") + " (" + rec.pct + "%)" : "Not watched yet in this browser"}</p>
        <p class="muted small">Public video: ${esc(v.youtube_title)} · ${esc(v.youtube_channel)}</p>
        <div class="yt-actions">
          <a class="btn ghost" href="${esc(youtubeUrl(v))}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
          <button class="btn ghost" type="button" data-watched="${esc(v.video_id)}">Mark as watched</button>
        </div>`;
    }
    if (v.youtube_search) {
      return `
        <p class="muted small">No close public match was found for this title, so a YouTube search is offered instead.</p>
        <div class="yt-actions">
          <a class="btn ghost" href="${esc(youtubeUrl(v))}" target="_blank" rel="noopener noreferrer">Search YouTube for a related video</a>
        </div>`;
    }
    return "";
  }

  function exportLogs() {
    const header = [
      "suggestion_id","suggestion_date","athlete_id","athlete_name","video_id","video_title",
      "reason_recommended","video_duration_sec","watch_seconds","completion_pct",
      "followup_window_days","followup_test","performance_time","distance_m","heart_rate_bpm",
      "performance_change","change_note","swot_strengths","swot_weaknesses","swot_opportunities",
      "swot_threats","coach_notes","record_status"
    ];
    const rows = [];
    for (const set of state.suggestions) {
      const log = state.logs.find((l) => l.setId === set.id);
      const prof = state.profiles.find((p) => p.id === set.athleteId);
      for (const vid of set.videos) {
        const v = videoById(vid);
        const watch = log?.watch?.[vid] || {};
        const watchSec = watch.seconds != null && watch.seconds !== ""
          ? Number(watch.seconds)
          : (watch.pct != null && v ? Math.round(v.duration_sec * Number(watch.pct) / 100) : "");
        const pct = watch.pct != null && watch.pct !== "" ? Number(watch.pct) : "";
        let windowDays = "";
        if (log) {
          const a = new Date(set.date);
          const b = new Date(log.date);
          windowDays = Math.max(0, Math.round((b - a) / 86400000));
        }
        rows.push([
          set.id + "-" + vid, set.date, set.athleteId, prof?.name || "",
          vid, v?.title || "", set.reasons[vid] || "", v?.duration_sec || "",
          watchSec, pct, windowDays, log?.test || "",
          log?.time || "", log?.distance || "", log?.hr || "",
          log?.change || "", log?.note || "",
          log?.swot?.s || "", log?.swot?.w || "", log?.swot?.o || "", log?.swot?.t || "",
          log?.note || "", "demo_local_log"
        ]);
      }
    }
    const csv = [header, ...rows].map((r) => r.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "suggestion_logs_export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function render() {
    destroyPlayers();
    steps.hidden = false;
    for (const b of steps.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.view === view);
    }
    const p = current();
    if (view === "roster") return renderRoster();
    if (!p && view !== "profile") { view = "roster"; return renderRoster(); }
    if (view === "profile") return renderProfile(p);
    if (view === "needs") return renderNeeds(p);
    if (view === "suggest") return renderSuggest(p);
    if (view === "log") return renderLog(p);
    if (view === "history") return renderHistory(p);
  }

  function renderRoster() {
    app.innerHTML = `
      <p class="kicker">Roster</p>
      <h2 style="margin:0 0 8px">Swimmers on this device</h2>
      <p class="muted small">Profiles stay in this browser only. You can also load the fictional sample squad from the assignment knowledge base.</p>
      <div class="list" id="roster-list" style="margin-top:14px"></div>
      <div class="actions">
        <button class="btn primary" id="new-swimmer">New profile</button>
        <button class="btn ghost" id="load-samples">Load sample profiles</button>
      </div>
    `;
    const list = $("#roster-list");
    if (!state.profiles.length) {
      list.innerHTML = `<p class="muted">No swimmers yet. Create a profile or load the sample squad.</p>`;
    } else {
      list.innerHTML = state.profiles.map((p) => `
        <div class="swimmer" data-id="${esc(p.id)}">
          <div>
            <strong>${esc(p.name)}</strong>
            <div class="muted small">${esc(p.ageBand || "")} · ${esc(p.level || "")} · ${esc(p.stroke || "")}</div>
          </div>
          <span class="badge">Open</span>
        </div>`).join("");
    }
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".swimmer");
      if (!row) return;
      currentId = row.dataset.id;
      go("profile");
    });
    $("#new-swimmer").onclick = () => {
      currentId = null;
      go("profile");
    };
    $("#load-samples").onclick = () => {
      for (const s of KB.sampleProfiles) {
        if (state.profiles.some((p) => p.id === s.athlete_id)) continue;
        state.profiles.push({
          id: s.athlete_id,
          name: s.display_name,
          ageBand: s.age_band,
          level: s.level,
          stroke: s.primary_stroke,
          secondStroke: s.secondary_stroke === "none" ? "" : s.secondary_stroke,
          events: (s.main_events || []).join(", "),
          weaknesses: s.weakness_tags || [],
          goal: s.programme_note,
          fictional: true
        });
      }
      save();
      render();
    };
  }

  function renderProfile(p) {
    const w = new Set(p?.weaknesses || []);
    const weaknessOptions = [
      ["underwater_dolphin_kick", "Underwater kick"],
      ["streamline", "Streamline"],
      ["late_breakout", "Breakout timing"],
      ["start_reaction", "Start / block"],
      ["sprint_finish", "Sprint finish"],
      ["breathing_pattern", "Breathing / head position"],
      ["high_elbow_catch", "Catch / pull"],
      ["IM_turns", "IM turns"],
      ["breaststroke_kick", "Breaststroke kick"],
      ["butterfly_kick_timing", "Butterfly kick timing"],
      ["backstroke_start", "Backstroke start"],
      ["race_pacing", "Race pacing"]
    ];
    app.innerHTML = `
      <p class="kicker">Profile</p>
      <h2 style="margin:0 0 14px">${p ? "Edit " + esc(p.name) : "New swimmer"}</h2>
      <form id="profile-form">
        <div class="grid two">
          <div class="field"><label for="name">Name or nickname</label><input id="name" required value="${esc(p?.name || "")}" /></div>
          <div class="field"><label for="age">Age band</label>
            <select id="age">
              ${["13-14","15-16","17-18","25-34","masters / other"].map((x) =>
                `<option ${p?.ageBand===x?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="level">Level</label>
            <select id="level">
              ${["club beginner","regional age-group","junior national","masters club"].map((x) =>
                `<option ${p?.level===x?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="stroke">Main stroke</label>
            <select id="stroke">
              ${["freestyle","backstroke","breaststroke","butterfly","individual_medley"].map((x) =>
                `<option value="${x}" ${p?.stroke===x?"selected":""}>${x.replace("_"," ")}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="events">Main events</label><input id="events" placeholder="e.g. 50 free; 100 free" value="${esc(p?.events || "")}" /></div>
          <div class="field"><label for="goal">Goal or programme note</label><input id="goal" value="${esc(p?.goal || "")}" /></div>
        </div>
        <div class="field"><label>Known weaknesses</label>
          <div class="choices">
            ${weaknessOptions.map(([val, lab]) =>
              `<label class="chip"><input type="checkbox" name="weak" value="${val}" ${w.has(val)?"checked":""} /> ${lab}</label>`
            ).join("")}
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Save profile</button>
          <button class="btn ghost" type="button" id="to-needs">Next: needs analysis</button>
          ${p ? `<button class="btn ghost" type="button" id="delete-p">Remove</button>` : ""}
        </div>
      </form>
    `;
    $("#profile-form").onsubmit = (e) => {
      e.preventDefault();
      const weaknesses = [...document.querySelectorAll('input[name="weak"]:checked')].map((i) => i.value);
      if (!p) {
        p = { id: uid("ATH"), fictional: false };
        state.profiles.push(p);
      }
      Object.assign(p, {
        name: $("#name").value.trim(),
        ageBand: $("#age").value,
        level: $("#level").value,
        stroke: $("#stroke").value,
        events: $("#events").value.trim(),
        goal: $("#goal").value.trim(),
        weaknesses
      });
      currentId = p.id;
      save();
      go("needs");
    };
    $("#to-needs").onclick = () => { if (current()) go("needs"); };
    const del = $("#delete-p");
    if (del) del.onclick = () => {
      if (!confirm("Remove this profile from this browser?")) return;
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      currentId = state.profiles[0]?.id || null;
      save();
      go("roster");
    };
  }

  function renderNeeds(p) {
    app.innerHTML = `
      <p class="kicker">${esc(p.name)}</p>
      <h2 style="margin:0 0 8px">When do they need help most?</h2>
      <p class="muted small">A short analysis — five questions. This steers the video set; it does not replace watching the swimmer in the water.</p>
      <form id="needs-form" style="margin-top:16px">
        <div class="field"><label>1. In a race or a hard set, where do they lose the most?</label>
          <div class="choices" id="when">
            ${[
              ["start","Start and block"],
              ["underwater","Underwater and breakout"],
              ["turns","Turns"],
              ["midrace","Mid-race pacing or breathing"],
              ["finish","Last 10 metres / finish"],
              ["stroke","Stroke pattern"]
            ].map(([v,l]) => `<label class="chip"><input type="radio" name="when" value="${v}" required /> ${l}</label>`).join("")}
          </div>
        </div>
        <div class="field"><label>2. Which of these feels most true right now? (pick up to two)</label>
          <div class="choices">
            ${[
              ["underwater_dolphin_kick","The kick breaks down underwater"],
              ["late_breakout","They surface too early or too late"],
              ["start_reaction","The start is slow"],
              ["race_pacing","They fade after the first 50"],
              ["high_elbow_catch","The catch slips"],
              ["IM_turns","Turns are messy"],
              ["breathing_pattern","Breathing lifts the head"]
            ].map(([v,l]) => `<label class="chip"><input type="checkbox" name="detail" value="${v}" /> ${l}</label>`).join("")}
          </div>
        </div>
        <div class="field"><label>3. What are they preparing for?</label>
          <select id="prep">
            <option value="50">50 sprint</option>
            <option value="100">100</option>
            <option value="200">200 or longer</option>
            <option value="im">Individual medley</option>
            <option value="mixed">Mixed / general training</option>
          </select>
        </div>
        <div class="field"><label>4. How much will they actually watch and try this week?</label>
          <select id="time">
            <option value="short">A short clip only</option>
            <option value="medium" selected>Up to about 20 minutes</option>
            <option value="dryland">They can also do dryland homework</option>
          </select>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Build a video set</button>
        </div>
      </form>
    `;
    $("#needs-form").onsubmit = (e) => {
      e.preventDefault();
      const when = document.querySelector('input[name="when"]:checked').value;
      const tags = [...document.querySelectorAll('input[name="detail"]:checked')].map((i) => i.value).slice(0, 2);
      draftNeeds = { when, tags, prep: $("#prep").value, time: $("#time").value };
      const picked = suggestFor(p, draftNeeds);
      const set = {
        id: uid("SET"),
        athleteId: p.id,
        date: today(),
        needs: draftNeeds,
        summary: needSummary(p, draftNeeds),
        videos: picked.map((x) => x.videoId),
        reasons: Object.fromEntries(picked.map((x) => [x.videoId, x.reason]))
      };
      state.suggestions.unshift(set);
      lastSetId = set.id;
      save();
      go("suggest");
    };
  }

  function latestSet(p) {
    return state.suggestions.find((s) => s.id === lastSetId && s.athleteId === p.id)
      || state.suggestions.find((s) => s.athleteId === p.id);
  }

  function renderSuggest(p) {
    const set = latestSet(p);
    if (!set) {
      app.innerHTML = `<p>No video set yet.</p><div class="actions"><button class="btn primary" id="go-n">Start needs analysis</button></div>`;
      $("#go-n").onclick = () => go("needs");
      return;
    }
    lastSetId = set.id;
    app.innerHTML = `
      <p class="kicker">${esc(p.name)} · ${esc(set.date)}</p>
      <h2 style="margin:0 0 10px">Suggested video collection</h2>
      <p class="summary">${esc(set.summary)}</p>
      <div class="list" id="vids"></div>
      <div class="actions">
        <button class="btn primary" id="to-log">After practice, log the session</button>
        <button class="btn ghost" id="redo">Ask again</button>
      </div>
    `;
    $("#vids").innerHTML = set.videos.map((id) => {
      const v = videoById(id);
      return `<article class="video" data-id="${id}">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="kicker">${esc(id)} · ${esc(v.duration_label)} · ${esc(v.source_type)}</div>
            <strong>${esc(v.title)}</strong>
            <p class="reason">${esc(set.reasons[id] || "")}</p>
            <p class="muted small">${esc(v.source_note)}</p>
          </div>
          <button class="btn ghost" type="button" data-drop="${id}">Drop</button>
        </div>
        ${videoCardMedia(v)}
      </article>`;
    }).join("");
    $("#vids").addEventListener("click", (e) => {
      const drop = e.target.dataset.drop;
      if (!drop) return;
      set.videos = set.videos.filter((x) => x !== drop);
      delete set.reasons[drop];
      save();
      renderSuggest(p);
    });
    bindYtPlayers(set.videos);
    $("#to-log").onclick = () => go("log");
    $("#redo").onclick = () => go("needs");
  }

  function renderLog(p) {
    const set = latestSet(p);
    if (!set) {
      app.innerHTML = `<p>Create a video set first, then log what happened after the swimmer tried it.</p>
        <div class="actions"><button class="btn primary" id="go-n">Needs analysis</button></div>`;
      $("#go-n").onclick = () => go("needs");
      return;
    }
    const existing = state.logs.find((l) => l.setId === set.id);
    const L = existing || { watch: {}, swot: {} };
    app.innerHTML = `
      <p class="kicker">${esc(p.name)} · follow-up for ${esc(set.date)} set</p>
      <h2 style="margin:0 0 10px">After they try the exercises</h2>
      <p class="muted small">Watch time can be filled from what this browser recorded while the swimmer played the suggested videos. Time and heart rate still need a pool-side entry.</p>
      <form id="log-form">
        <div class="actions" style="margin:0 0 14px">
          <button class="btn primary" type="button" id="auto-fill">Auto-fill from watched videos</button>
        </div>
        <p class="muted small" id="auto-msg" hidden></p>
        <div class="grid two">
          <div class="field"><label for="ldate">Session date</label><input id="ldate" type="date" value="${esc(L.date || today())}" required /></div>
          <div class="field"><label for="ltest">What did you look at?</label><input id="ltest" placeholder="e.g. club 50 free time trial" value="${esc(L.test || "")}" /></div>
          <div class="field"><label for="ltime">Performance time</label><input id="ltime" placeholder="e.g. 28.40 or 1:05.2" value="${esc(L.time || "")}" /></div>
          <div class="field"><label for="ldist">Distance / length (metres)</label><input id="ldist" type="number" min="0" step="25" value="${esc(L.distance || "")}" /></div>
          <div class="field"><label for="lhr">Heart rate (bpm, optional)</label><input id="lhr" type="number" min="0" value="${esc(L.hr || "")}" /></div>
          <div class="field"><label for="lchange">Performance change</label>
            <select id="lchange">
              ${["improved","mixed or unclear","no clear change","not assessable (low watch)"].map((x) =>
                `<option ${L.change===x?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
        </div>
        <h3>How much of each video did they watch?</h3>
        <div class="list">
          ${set.videos.map((id) => {
            const v = videoById(id);
            const rec = watchedFor(id, v?.duration_sec);
            const w = L.watch?.[id] || {};
            const seconds = w.seconds ?? (rec.seconds || "");
            const pct = w.pct ?? (rec.seconds ? rec.pct : "");
            const maxSec = rec.duration || v.duration_sec;
            return `<div class="video">
              <strong>${esc(v.title)}</strong>
              ${videoCardMedia(v)}
              <div class="grid two" style="margin-top:8px">
                <div class="field"><label>Watched (seconds)</label><input data-watch-sec="${id}" type="number" min="0" max="${maxSec}" value="${esc(seconds)}" /></div>
                <div class="field"><label>Or completion %</label><input data-watch-pct="${id}" type="number" min="0" max="100" value="${esc(pct)}" /></div>
              </div>
            </div>`;
          }).join("")}
        </div>
        <h3>SWOT</h3>
        <div class="grid two">
          <div class="field"><label for="swot-s">Strengths</label><textarea id="swot-s">${esc(L.swot?.s || "")}</textarea></div>
          <div class="field"><label for="swot-w">Weaknesses</label><textarea id="swot-w">${esc(L.swot?.w || "")}</textarea></div>
          <div class="field"><label for="swot-o">Opportunities</label><textarea id="swot-o">${esc(L.swot?.o || "")}</textarea></div>
          <div class="field"><label for="swot-t">Threats</label><textarea id="swot-t">${esc(L.swot?.t || "")}</textarea></div>
        </div>
        <div class="field"><label for="lnote">Performance / coach note</label><textarea id="lnote">${esc(L.note || "")}</textarea></div>
        <div class="actions"><button class="btn primary" type="submit">Save follow-up log</button></div>
      </form>
    `;
    const applyAuto = () => {
      const result = autoFillDraft(p, set, existing);
      const msg = $("#auto-msg");
      msg.hidden = false;
      msg.textContent = result.anyWatch
        ? "Watch time, a suggested test, default distance, and SWOT/note starters were filled from the videos played in this browser. You can still edit anything before saving."
        : "No in-app watch time was found yet, so the form has a suggested test and distance from the profile, and a note that watch time is still missing. Play the videos on the Video set page, or mark them as watched, then try again.";
    };
    $("#auto-fill").onclick = () => applyAuto();
    bindYtPlayers(set.videos);
    $("#log-form").onsubmit = (e) => {
      e.preventDefault();
      const watch = {};
      for (const id of set.videos) {
        const seconds = document.querySelector(`[data-watch-sec="${id}"]`).value;
        let pct = document.querySelector(`[data-watch-pct="${id}"]`).value;
        const v = videoById(id);
        const rec = watchedFor(id, v?.duration_sec);
        const duration = rec.duration || v.duration_sec;
        if ((pct === "" || pct == null) && seconds !== "" && duration) {
          pct = Math.round(Number(seconds) / duration * 100);
        }
        watch[id] = { seconds, pct };
      }
      const entry = {
        id: existing?.id || uid("LOG"),
        setId: set.id,
        athleteId: p.id,
        date: $("#ldate").value,
        test: $("#ltest").value.trim(),
        time: $("#ltime").value.trim(),
        distance: $("#ldist").value,
        hr: $("#lhr").value,
        change: $("#lchange").value,
        note: $("#lnote").value.trim(),
        swot: {
          s: $("#swot-s").value.trim(),
          w: $("#swot-w").value.trim(),
          o: $("#swot-o").value.trim(),
          t: $("#swot-t").value.trim()
        },
        watch
      };
      if (existing) Object.assign(existing, entry);
      else state.logs.unshift(entry);
      save();
      go("history");
    };
  }

  function renderHistory(p) {
    const sets = state.suggestions.filter((s) => s.athleteId === p.id);
    app.innerHTML = `
      <p class="kicker">${esc(p.name)}</p>
      <h2 style="margin:0 0 8px">History &amp; export</h2>
      <p class="muted small">Export writes a CSV in the same spirit as the assignment suggestion log, so you can use it in a ChatGPT or Azure try-out later.</p>
      <div class="actions" style="margin-bottom:14px">
        <button class="btn primary" id="export">Export CSV logs</button>
        <button class="btn ghost" id="go-roster">Back to roster</button>
      </div>
      <div class="list" id="hist"></div>
    `;
    const hist = $("#hist");
    if (!sets.length) hist.innerHTML = `<p class="muted">No suggestions yet for this swimmer.</p>`;
    else hist.innerHTML = sets.map((s) => {
      const log = state.logs.find((l) => l.setId === s.id);
      const titles = s.videos.map((id) => videoById(id)?.title || id).join("; ");
      return `<article class="hist">
        <div class="kicker">${esc(s.date)}${log ? " · follow-up " + esc(log.date) : " · no follow-up yet"}</div>
        <strong>${esc(titles)}</strong>
        <p class="reason">${esc(s.summary)}</p>
        ${log ? `<p class="small">Time ${esc(log.time || "—")} · ${esc(log.distance || "—")} m · HR ${esc(log.hr || "—")} · ${esc(log.change || "")}</p>` : ""}
      </article>`;
    }).join("");
    $("#export").onclick = exportLogs;
    $("#go-roster").onclick = () => go("roster");
  }

  app.addEventListener("click", (e) => {
    const mark = e.target.closest("[data-watched]")?.dataset.watched;
    if (!mark) return;
    const v = videoById(mark);
    const rec = watchedFor(mark, v?.duration_sec);
    const duration = rec.duration || v?.duration_sec || 0;
    recordWatch(mark, duration || rec.seconds || 1, duration);
    updateWatchMeter(mark);
    const rec2 = watchedFor(mark, duration);
    const sec = document.querySelector(`[data-watch-sec="${mark}"]`);
    const pct = document.querySelector(`[data-watch-pct="${mark}"]`);
    if (sec) sec.value = rec2.seconds;
    if (pct) pct.value = rec2.pct;
  });

  render();
})();
