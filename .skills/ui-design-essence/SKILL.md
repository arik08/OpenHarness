---
name: ui-design-essence
description: Visual UI design standards for creating or improving pages, components, dashboards, reports, prototypes, landing pages, and HTML previews. Use when designing frontend/UI work, polishing visual hierarchy, choosing style direction, creating design tokens, avoiding generic AI-looking interfaces, or reviewing UI for consistency, responsiveness, accessibility, density, and purposeful motion.
---

# UI Design Essence

Use this skill when creating or improving visual UI. Do not make a generic good-looking UI; choose a clear point of view and execute it precisely.

## Start with a design direction

Before coding, decide and briefly state:

- **Purpose**: what the interface must accomplish.
- **User**: who uses it and in what context.
- **Mood**: the intended feeling, not a vague adjective pile.
- **Density**: spacious, balanced, or compact. Default to slim, clean, work-focused density.
- **Signature detail**: one memorable visual or interaction detail, not many.

## Define a small token system

Create or reuse tokens before styling components:

- Colors: `background`, `surface`, `text`, `muted text`, `border`, `accent`.
- Spacing scale.
- Radius scale.
- Shadow/elevation scale.
- Motion timing.

Do not invent new colors, font sizes, radii, shadows, or animation timings inside individual components. If a new visual value is needed, add it to the token system first.

## Prioritize hierarchy before decoration

Decide:

- What should the user notice first?
- What is the primary action?
- What is secondary?
- What can be hidden, softened, or removed?

Make the first read obvious. Keep secondary content quieter. Remove decorative elements that do not support comprehension or action.

## Avoid generic AI UI clichés

Do not default to:

- Purple/blue/pink gradients.
- Inter, Roboto, Arial, or `system-ui` as lazy primary fonts.
- Repeated fallback to the same “interesting” fonts.
- Generic SaaS blue (`#3B82F6`) as the default accent.
- Rounded card grids with gradient buttons as the default recipe.
- Random glassmorphism or blob backgrounds.
- Emoji as structural icons.
- Fake logos, fake metrics, fake testimonials.
- Decorative icon spam.

Use honest placeholders: `[icon]`, simple geometry, aspect-ratio image placeholders, or clearly marked sample data.

## Choose density intentionally

- Marketing/editorial: spacious is allowed.
- Product UI: balanced density.
- Dashboard/admin/report: compact, aligned, information-dense.

For business-style reports and dashboards, prefer restrained, work-focused visuals: aligned tables, clear labels, compact panels, and square or lightly rounded corners.

## Use motion only for state

Use motion to explain state changes, not to decorate:

- Prefer 150–300ms transitions.
- Animate `transform` and `opacity`.
- Respect `prefers-reduced-motion`.
- Use one well-timed reveal rather than many scattered animations.

## Delivery checklist

Before delivering, check:

- Clear first read and primary action.
- Consistent tokens.
- No generic AI clichés.
- Responsive layout works.
- Touch targets and focus states exist.
- Text does not overflow.
- Motion is purposeful and not excessive.
