# Noodleplanner Icon Suite — Integration Guide

This document explains how to integrate the noodleplanner SVG icon sprite into the app.

---

## What we have

A single HTML file (`noodleplanner-icons.html`) containing an SVG sprite with 10 icons:

| ID | Use for |
|----|---------|
| `icon-project-report` | Project Report view |
| `icon-task-list` | Task List view |
| `icon-board` | Kanban Board view |
| `icon-calendar` | Calendar view |
| `icon-timeline` | Timeline view |
| `icon-resources` | Resources view |
| `icon-raid-log` | RAID Log view |
| `icon-highlights` | Highlights view |
| `icon-milestones` | Milestones view |
| `icon-gantt-chart` | Gantt Chart view |

---

## Step 1 — Extract the sprite

Copy everything between (and including) the two `<svg>` tags at the top of the HTML file into your project. It looks like this:

```html
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <defs>
    <symbol id="icon-project-report" viewBox="0 0 24 24"> ... </symbol>
    <symbol id="icon-task-list" viewBox="0 0 24 24"> ... </symbol>
    <!-- ...etc -->
  </defs>
</svg>
```

---

## Step 2 — Where to put it

**Option A — Inline in your HTML (simplest)**
Paste the sprite block immediately after the opening `<body>` tag in your main layout file. The `display:none` keeps it invisible.

**Option B — Separate SVG file**
Save the sprite as `public/icons/sprite.svg` (or `assets/icons/sprite.svg`). Then reference it with an absolute path:

```html
<svg width="24" height="24">
  <use href="/icons/sprite.svg#icon-task-list"/>
</svg>
```

> Note: External SVG file references don't work when opening HTML files directly from the filesystem (`file://`). They work fine on any web server including `localhost`.

**Option C — React / Vue / Svelte component**
Create an `IconSprite` component that renders the sprite inline, import it once in your root layout, then create a reusable `Icon` component (see Step 4).

---

## Step 3 — Basic usage

Once the sprite is available (inline or external file), use any icon like this:

```html
<!-- 24px icon (default nav size) -->
<svg width="24" height="24" aria-hidden="true">
  <use href="#icon-gantt-chart"/>
</svg>

<!-- 16px icon (compact/inline) -->
<svg width="16" height="16" aria-hidden="true">
  <use href="#icon-milestones"/>
</svg>

<!-- 48px icon (feature card / hero) -->
<svg width="48" height="48" aria-hidden="true">
  <use href="#icon-board"/>
</svg>
```

For accessibility, add a label when the icon is the only content in a button or link:

```html
<button aria-label="Open Task List">
  <svg width="24" height="24" aria-hidden="true">
    <use href="#icon-task-list"/>
  </svg>
</button>
```

---

## Step 4 — CSS theming

All icons use `stroke` (not `fill`), so they inherit colour from the current text colour automatically. Add this to your global stylesheet:

```css
svg.icon {
  display: inline-block;
  vertical-align: middle;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

Then on any element:

```css
/* Active nav item */
.nav-item.active svg.icon {
  stroke: #7c6af7; /* purple accent */
}

/* Hover */
.nav-item:hover svg.icon {
  stroke: #f2a65a; /* amber accent */
}

/* Dark mode — no changes needed, currentColor handles it */
```

---

## Step 5 — Reusable component examples

### React

```jsx
// components/Icon.jsx
export function Icon({ name, size = 24, className = '', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      className={`icon ${className}`}
      aria-hidden="true"
      {...props}
    >
      <use href={`#icon-${name}`} />
    </svg>
  );
}

// Usage
<Icon name="gantt-chart" size={24} />
<Icon name="task-list" size={16} className="text-purple-500" />
```

### Svelte

```svelte
<!-- Icon.svelte -->
<script>
  export let name;
  export let size = 24;
</script>

<svg width={size} height={size} class="icon" aria-hidden="true">
  <use href={`#icon-${name}`} />
</svg>
```

### Vue

```vue
<!-- Icon.vue -->
<template>
  <svg :width="size" :height="size" class="icon" aria-hidden="true">
    <use :href="`#icon-${name}`" />
  </svg>
</template>

<script setup>
defineProps({ name: String, size: { default: 24 } });
</script>
```

---

## Icon names quick reference

```
icon-project-report
icon-task-list
icon-board
icon-calendar
icon-timeline
icon-resources
icon-raid-log
icon-highlights
icon-milestones
icon-gantt-chart
```

---

## Notes for Claude Code

- All icons are designed on a **24×24 viewBox** with **1.5px stroke width**
- Stroke scales visually well from 16px to 96px without modification
- At very small sizes (≤ 14px) consider increasing `stroke-width` to `2` for legibility
- Icons use only `stroke` — never `fill` — so colour is controlled entirely via CSS
- The sprite has no external dependencies, no JavaScript required
