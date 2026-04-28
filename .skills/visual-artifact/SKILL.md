---
name: visual-artifact
description: Create polished single-file HTML visual artifacts such as reports, dashboards, infographics, one-pagers, slide-like webpages, visual summaries, comparison pages, timelines, and interactive previews. Use when the user asks for a beautiful/dynamic webpage-like output, HTML preview, visual report, presentation-style page, screenshot-ready artifact, PDF-ready page, business/research summary, or any reusable visual deliverable intended to be opened in a browser or captured into PPT/PDF.
---

# Visual Artifact

Create browser-native visual deliverables that are polished enough to screenshot, present, print, or convert to PDF/PPT.

## Default output

- Prefer one self-contained `.html` file with inline CSS and JS.
- Use a short purpose-specific kebab-case filename, not `index.html`, unless the user explicitly asks for it or an existing app requires it.
- Keep dependencies minimal. Use no CDN when CSS/SVG is enough; use CDN libraries when they materially improve the result.
- Make the artifact readable in a constrained iframe and in a normal browser window.
- Do not include secrets or unsanitized user-provided HTML.

## Decide the artifact type

- **Executive/report page**: structured findings, tables, charts, recommendations, sources.
- **Dashboard**: KPI cards, charts, filters/toggles if useful, data table.
- **Infographic/one-pager**: strong story flow, big numbers, compact sections, print/capture-ready layout.
- **Slide-like HTML**: 16:9 sections, keyboard or scroll navigation only if useful.
- **Diagram/timeline/comparison**: SVG, Mermaid, or HTML/CSS layouts depending on complexity.

## Design bar

- Aim for “usable in a real meeting,” not merely “AI-generated.”
- Use restrained business styling: clear type scale, tight spacing, meaningful hierarchy, limited palette.
- Avoid oversized radii, pill-heavy cards, excessive gradients, and bloated padding unless requested.
- Prefer 4–8px radius for panels/cards/buttons.
- Use exact tables for exact values; use charts for trends, comparisons, proportions, timelines, or distributions.
- Use accessible contrast and semantic HTML.

## Library choices

- **ECharts**: multi-chart business dashboards/reports.
- **Chart.js**: simple common charts.
- **SVG/CSS**: small bespoke charts, diagrams, cards, timelines.
- **Mermaid**: maintainable flowcharts/architecture diagrams.
- **Reveal.js**: full HTML slide decks.
- **Three.js/D3/Leaflet**: only when 3D, advanced data visualization, or maps are central.

## Workflow

1. Infer audience, output type, size target, and reuse goal. Ask only if ambiguity risks the wrong artifact.
2. Structure the content before styling: sections, data, charts, interactions, export needs.
3. Build the single HTML artifact with responsive CSS and print/capture considerations.
4. Include `@media print` for PDF-friendly output when the artifact is report-like or slide-like.
5. If the user wants screenshots/PDF, use the `playwright-capture` skill after creating the HTML.
6. For important or dense visuals, use the `visual-review` skill to inspect clipping, overflow, chart labels, and print layout.

## Capture-friendly conventions

- For presentation-style output, include a `.stage` or `.slide` layout with 16:9 ratio when appropriate.
- For reports, make A4/Letter print behavior explicit with sensible page breaks.
- Avoid content that depends on hover-only interactions for core meaning.
- Keep animations subtle and disable or simplify them for print.

## References

- Read `references/design-checklist.md` when polishing a high-stakes visual, report, dashboard, or presentation artifact.
