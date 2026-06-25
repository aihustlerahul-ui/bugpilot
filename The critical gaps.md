The critical gaps

1. Drawing / annotation on screenshots — This is the #1 table-stakes feature. Every QA tool (Marker.io, Userback, BugHerd) lets you draw arrows, boxes, and circles directly on the screenshot before submitting. Without it, reporters have to describe visually where the problem is in text. This alone could be a week of work but changes the product feel dramatically.

2. GitHub Issues + Linear — Azure DevOps is maybe 20–25% of the market. GitHub Issues and Linear are where most product + dev teams live. The connector infrastructure is already there; it's a backend service + UI guide per integration.

3. AI auto-fill — You already capture: nav history, element metadata, console errors, URL, severity signals. A single Claude API call at submit time could write the title, description, and reproduction steps automatically. This is the "wow" moment. No competitor does this well yet.

4. Guest / magic-link reporting — The extension install requirement kills adoption with non-technical stakeholders (PMs, clients, designers). A shareable link that opens a lightweight JS embed (no extension) is how Marker.io grew. This is a bigger architectural decision but the highest growth lever.

5. Duplicate detection — Before submit, hash URL + CSS selector and check against existing open issues. Cheap to build, saves significant noise for dev teams.

6. Slack / Teams webhook — Dev teams want an instant ping in their channel. A simple outbound webhook per workspace unlocks this without being a full integration.

Stretch / differentiators

Session replay (rrweb) — Record DOM mutations, replay the exact steps to reproduce. LogRocket charges $$$$ for this. Embedding rrweb in the extension and storing snapshots is technically feasible but storage-heavy.
In-page status overlay — Show colored badges on elements that have open/resolved issues (like GitHub code review inline). Makes QA sessions feel live and collaborative.
Full network request capture — You capture failures; capturing all requests (with headers) would give devs the full picture.
The fastest path to competitive parity is drawing tools + GitHub/Linear + AI auto-fill in that order. Want me to scope any of these out?
