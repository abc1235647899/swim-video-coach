# Swim Video Coach (demo)

A simple browser app for Albert Chung’s GGU DBA Assignment 1, option 10 (swimming coach).

It shows how a club could *create* the official knowledge-base logs over time: a swimmer profile, a short needs analysis, a small suggested video set, then an after-practice log (time, distance, heart rate, SWOT, and how much of each video was watched). The official assignment knowledge base is those logs, not the YouTube videos themselves.

This app is optional. Assignment 1 can still be submitted with the illustrative sample logs already in `kb_coach`.

## How to open

No special hosting is required. This is a static site (`index.html`, `styles.css`, `app.js`, `data.js`).

- Live demo on GitHub Pages: https://abc1235647899.github.io/swim-video-coach/
- Or, on your computer, open `index.html` in Chrome or Edge. Keep the sibling files in the same folder. Watch-time tracking works more reliably on the Pages site (or any local web server) than from a `file://` path, because YouTube’s player API expects an `http` origin.

Profiles and logs stay in that browser only (local storage). Use **Export CSV logs** on the History page if you want a file for a later ChatGPT or Azure try-out.

## What you can do

1. Create a profile, or load the fictional sample squad.
2. Answer five questions about when the swimmer needs help most.
3. Review a 3–5 video collection, with a public YouTube tutorial where a close match exists (drop any title you do not want).
4. After practice, use **Auto-fill from watched videos** to bring in recorded watch time, a suggested follow-up test, a default distance from the swimmer’s events, and SWOT/note starters. Time and heart rate are still entered by hand.
5. Export the suggestion/outcome CSV.

Catalogue titles are illustrative. The public YouTube clips are related tutorials, not club footage, and are not stored in this repository. For one title (sprint finish), no close public match was found, so the app offers a YouTube search instead. This is demo data, not a real club roster.
