# DaySponsor — Design System & Rules

This document captures the complete design system used across the DaySponsor application. Follow these rules when building any new page or component so the result is visually consistent with the existing site.

---

## 1. Design Philosophy

**Honest, premium, minimal.** The product is about real creator experiences — not flashy ads. The design reflects that: generous whitespace, restrained color, clean typography, and subtle motion. The aesthetic sits somewhere between a modern SaaS landing page and an editorial publication.

**Key principles:**
- **Whitespace over clutter** — let content breathe. Avoid filling every pixel.
- **One accent color** — green-teal (`hsl(158 64% 42%)`) is the only saturated color used for interactive highlights, success states, and brand accents. Everything else is neutral greyscale.
- **Editorial serif for emphasis** — `Instrument Serif` italic is used sparingly for emotional or headline moments, not body text.
- **Motion is subtle and purposeful** — fade-up entrances, hover scale on interactive elements, pulsing status dots. Never bouncy or distracting.
- **Honesty in UI** — badges like "No guaranteed positive reviews" and "Honest opinions, always" are design elements, not just copy.

---

## 2. Color System

Colors are defined as HSL CSS variables in `app/globals.css` and mapped to Tailwind tokens in `tailwind.config.ts`. **Always use the Tailwind token (e.g. `bg-accent`, `text-muted-foreground`), never raw HSL values in components.**

### Light Mode (default)

| Token              | HSL               | Hex (approx)  | Usage                                    |
|--------------------|-------------------|---------------|------------------------------------------|
| `background`       | `0 0% 100%`       | `#FFFFFF`     | Page background                          |
| `foreground`       | `0 0% 5%`         | `#0D0D0D`     | Primary text, dark UI elements           |
| `card`             | `0 0% 100%`       | `#FFFFFF`     | Card surfaces (same as background)       |
| `card-foreground`  | `0 0% 5%`         | `#0D0D0D`     | Text on cards                            |
| `popover`          | `0 0% 100%`       | `#FFFFFF`     | Popovers, dropdowns                      |
| `popover-foreground`| `0 0% 5%`        | `#0D0D0D`     | Text in popovers                         |
| `primary`          | `0 0% 5%`         | `#0D0D0D`     | Primary buttons, key actions             |
| `primary-foreground`| `0 0% 98%`       | `#FAFAFA`     | Text on primary buttons                  |
| `secondary`        | `0 0% 96%`        | `#F5F5F5`     | Secondary surfaces, subtle backgrounds   |
| `secondary-foreground`| `0 0% 9%`      | `#171717`     | Text on secondary surfaces               |
| `muted`            | `0 0% 96%`        | `#F5F5F5`     | Muted backgrounds                        |
| `muted-foreground` | `0 0% 42%`        | `#6B6B6B`     | Secondary text, labels, helper text      |
| `accent`           | `158 64% 42%`     | `#27A37A`     | **Brand accent** — links, highlights, CTAs |
| `accent-foreground`| `0 0% 100%`      | `#FFFFFF`     | Text on accent-colored elements          |
| `destructive`      | `0 84% 60%`       | `#E63946`     | Errors, delete actions, "No" states      |
| `destructive-foreground`| `0 0% 98%`   | `#FAFAFA`     | Text on destructive buttons              |
| `border`           | `0 0% 90%`        | `#E6E6E6`     | All borders, dividers                    |
| `input`            | `0 0% 90%`        | `#E6E6E6`     | Input borders                            |
| `ring`             | `0 0% 5%`         | `#0D0D0D`     | Focus rings                              |

### Dark Mode (`.dark` class on `<html>`)

| Token              | HSL               | Hex (approx)  |
|--------------------|-------------------|---------------|
| `background`       | `0 0% 4%`         | `#0A0A0A`     |
| `foreground`       | `0 0% 98%`        | `#FAFAFA`     |
| `card`             | `0 0% 7%`         | `#121212`     |
| `secondary`        | `0 0% 12%`        | `#1F1F1F`     |
| `muted`            | `0 0% 14%`        | `#242424`     |
| `muted-foreground` | `0 0% 60%`        | `#999999`     |
| `accent`           | `158 64% 42%`     | `#27A37A` (same) |
| `destructive`      | `0 62% 40%`       | `#A52838`     |
| `border`           | `0 0% 16%`        | `#292929`     |

### Chart Colors

| Token     | HSL           | Usage                |
|-----------|---------------|----------------------|
| `chart-1` | `158 64% 42%` | Primary chart (accent green) |
| `chart-2` | `217 91% 60%` | Blue                 |
| `chart-3` | `38 92% 50%`  | Amber/gold           |
| `chart-4` | `280 65% 60%` | Purple               |
| `chart-5` | `340 75% 55%` | Pink/red             |

### Color Rules

1. **Never use purple, indigo, or violet** as primary or accent colors. The only exception is `chart-4` for data visualization.
2. **Accent green is sacred** — use it only for: primary CTAs in context, active states, success indicators, brand highlights, links, and "available" status. Do not use it for large background fills.
3. **Amber (`amber-400`, `amber-500`, `amber-600`)** is used for star ratings and "sponsored" badges. It is not a brand color — use sparingly.
4. **Red/destructive** is for errors, delete actions, and explicit "No" states only.
5. **Neutrals do the heavy lifting.** Most of the UI is greyscale. The accent provides the only pop of color.
6. **Always ensure readable contrast.** `muted-foreground` (`#6B6B6B` light / `#999999` dark) is the minimum for body text on backgrounds. Never go lighter.

---

## 3. Typography

### Font Families

| Token          | Font                    | Usage                                      |
|----------------|-------------------------|--------------------------------------------|
| `font-sans`    | **Inter** (Google Fonts via `next/font`) | All body text, UI labels, buttons, inputs |
| `font-display` | **Instrument Serif** (Google Fonts, `@import` in globals.css) | Headline emphasis, italic accents only    |

### Font Weights

- **Inter:** `400` (body), `500` (medium — labels, nav, buttons), `600` (semibold — headings, key text), `700` (bold — used rarely, for large stats)
- **Instrument Serif:** `400` only, typically `italic`
- **Maximum 3 weights** in any given view. Default to 400 + 600.

### Type Scale

Use Tailwind's font-size utilities. The site follows this scale:

| Element              | Classes                              | Example                                      |
|----------------------|--------------------------------------|----------------------------------------------|
| Hero headline        | `text-5xl sm:text-6xl lg:text-7xl`   | "Let brands sponsor your day."               |
| Section heading      | `text-3xl sm:text-4xl`               | "How it works"                               |
| Subheading           | `text-xl sm:text-2xl`                | Section subtitles                            |
| Body large           | `text-lg sm:text-xl`                 | Hero subtitle                                |
| Body                 | `text-base`                          | Default paragraph text                       |
| Body small           | `text-sm`                            | Card content, secondary text                 |
| Caption / label      | `text-xs`                            | Badges, metadata, uppercase labels           |
| Stats (large)        | `text-4xl font-bold`                 | "€18,420"                                    |

### Line Height

- **Headings:** `leading-[1.05]` for hero, `leading-tight` for section headings
- **Body:** `leading-relaxed` (1.625) for paragraphs
- **Default body:** `leading-normal` (1.5) — set globally on `body`

### Letter Spacing

- Headlines: `tracking-tight` (-0.025em)
- Uppercase labels: `tracking-wider` (0.05em) — used for small uppercase metadata like "Available sponsorships"
- Default: no tracking adjustment

### Typographic Utilities

- `.text-balance` — `text-wrap: balance` on headlines for even line breaks
- `.text-pretty` — `text-wrap: pretty` on paragraphs for better orphans/widows
- `.font-display` — applies Instrument Serif
- `.font-sans` — applies Inter (also set on `<body>`)

### Font Feature Settings

Inter has optional features enabled in `globals.css`:
```css
font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
```
These enable alternate glyphs for `a`, `g`, `i`, and `l` for a more refined look. Do not remove.

### Typography Rules

1. **Inter for everything except emotional headlines.** Instrument Serif italic is used only for short, impactful phrases — typically 1-3 words within a larger Inter heading.
2. **Never use Instrument Serif for body text, buttons, labels, or form text.**
3. **Use `text-balance` on all headlines** to prevent awkward line breaks.
4. **Uppercase labels** (`text-xs font-semibold uppercase tracking-wider`) are used for section eyebrows and metadata headers. Always paired with `text-muted-foreground`.

---

## 4. Spacing System

The site uses a consistent **8px base unit**. Tailwind's spacing scale already follows this (4 = 16px, 6 = 24px, 8 = 32px, etc.).

### Container Width

```
max-w-7xl  → 1280px (landing page, nav, footer)
max-w-4xl  → 896px  (centered text sections, auth forms)
max-w-2xl  → 672px  (single-column forms, review page)
max-w-5xl  → 1024px (hero mockup, wide cards)
```

### Horizontal Padding (responsive)

| Breakpoint   | Padding classes         | Pixel value |
|--------------|-------------------------|-------------|
| Mobile       | `px-4`                  | 16px        |
| `sm` (640px) | `sm:px-6`              | 24px        |
| `lg` (1024px)| `lg:px-8`              | 32px        |

**Always use this pattern:** `px-4 sm:px-6 lg:px-8`

### Section Spacing

| Element              | Classes                                    |
|----------------------|--------------------------------------------|
| Hero section         | `pt-32 pb-20 sm:pt-40 sm:pb-28`           |
| Standard section     | `py-20 sm:py-28`                           |
| Card internal padding| `p-6` (standard) or `p-8` (large cards)    |
| Form field spacing   | `space-y-6` between cards, `space-y-4` within |
| Stack gaps           | `gap-3` (tight), `gap-4` (normal), `gap-6` (loose) |

### Spacing Rules

1. **Always use Tailwind spacing utilities** — never custom pixel values.
2. **Section padding is always responsive** — more padding on larger screens.
3. **Cards use `p-6` by default, `p-8` for prominent cards** (hero mockup, campaign detail headers).
4. **The `pt-20` on page wrappers** accounts for the fixed navbar (64px height + breathing room).

---

## 5. Responsive Design Rules

The site is mobile-first. Every layout must work on a 375px viewport first, then enhance at breakpoints.

### Breakpoints (Tailwind defaults)

| Prefix | Min width | Typical target          |
|--------|-----------|-------------------------|
| (none) | 0px       | Mobile (375px+)         |
| `sm`   | 640px     | Large phones / small tablets |
| `md`   | 768px     | Tablets                  |
| `lg`   | 1024px    | Desktop                  |
| `xl`   | 1280px    | Large desktop            |

### How to make layouts responsive

**1. Start mobile-first.** Write the base styles for mobile, then add `sm:`, `md:`, `lg:` prefixes to enhance. Never write desktop-first and scale down.

**2. Use responsive grid columns.**
```jsx
// Two columns on desktop, one on mobile
<div className="grid sm:grid-cols-2 gap-4">

// Three columns on large screens
<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">

// Sidebar layout — stacked on mobile, side-by-side on desktop
<div className="grid md:grid-cols-[1fr_1.2fr] gap-0">
```

**3. Responsive typography.** Always scale headings up at larger breakpoints:
```jsx
<h1 className="text-5xl sm:text-6xl lg:text-7xl">
<p className="text-lg sm:text-xl">
```

**4. Responsive flex direction.** Stack vertically on mobile, horizontally on desktop:
```jsx
<div className="flex flex-col sm:flex-row items-center gap-3">
```

**5. Hide/show elements by breakpoint.**
```jsx
// Desktop nav, mobile hamburger
<div className="hidden md:flex ...">  {/* desktop nav */}
<button className="md:hidden ...">   {/* mobile toggle */}
```

**6. Responsive padding.** More padding on larger screens:
```jsx
<section className="pt-32 pb-20 sm:pt-40 sm:pb-28">
<div className="px-4 sm:px-6 lg:px-8">
```

**7. Use `flex-wrap` for tag/chip rows** so they wrap gracefully on narrow screens:
```jsx
<div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
```

**8. Test at these widths minimum:** 375px (iPhone SE), 768px (iPad), 1024px (laptop), 1280px (desktop). The layout must not break or overflow at any of these.

**9. Images and media** must use `max-w-full h-auto` or be wrapped in `aspect-ratio` containers. Never set fixed pixel widths on media.

**10. Touch targets** must be at least 44x44px. Buttons already meet this (`h-10` = 40px minimum, `h-11` for `lg`, `h-12` for hero CTAs).

### Responsive patterns used across the site

| Pattern              | Mobile                    | Desktop                      |
|----------------------|---------------------------|------------------------------|
| Navbar               | Hamburger menu            | Inline links + buttons       |
| Hero CTA buttons     | Stacked vertically        | Side by side                 |
| Feature grids        | Single column             | 2-3 columns                  |
| Card grids           | Single column             | 2-3 columns                  |
| Form layout          | Single column             | 2 columns for pros/cons      |
| Dashboard tables     | Stacked cards             | Full table                   |

---

## 6. Border Radius

The base radius is `0.75rem` (12px), defined as `--radius` in CSS.

| Element              | Class         | Value    |
|----------------------|---------------|----------|
| Cards                | `rounded-2xl` | 16px     |
| Buttons (default)    | `rounded-md`  | calc(0.75rem - 2px) = 10px |
| Buttons (CTA)        | `rounded-full`| pill     |
| Badges               | `rounded-full`| pill     |
| Inputs               | `rounded-md`  | 10px     |
| Small elements       | `rounded-lg`  | 12px     |
| Avatars              | `rounded-full`| circle   |
| Status dots          | `rounded-full`| circle   |

**Rule:** Primary CTAs use `rounded-full` (pill shape). Secondary buttons use the default `rounded-md`. Cards use `rounded-2xl`. This creates clear visual hierarchy — pill buttons draw the eye, rectangular cards organize content.

---

## 7. Shadows & Elevation

The design is intentionally flat. Shadows are used sparingly:

- **`shadow-2xl`** — only on the hero mockup card (the "browser window" preview). Creates a floating effect.
- **`shadow-sm`** — on hover for interactive cards (`hover:shadow-sm`).
- **No shadow** — most cards rely on `border border-border` for definition, not shadows.

**Rule:** Prefer borders over shadows for card separation. Use shadows only for elements that should feel "lifted" (modals, the hero preview, popovers).

---

## 8. Borders

- **Standard border:** `border border-border` (1px solid, `hsl(0 0% 90%)` light / `hsl(0 0% 16%)` dark)
- **Subtle border:** `border-border/50` — used for navbar bottom border, section dividers
- **Hover border:** `hover:border-foreground/20` or `hover:border-foreground/30` — interactive cards on hover
- **Active/selected border:** `border-accent` or `border-destructive` — used in selection states (e.g., "Would you buy this?" toggle)
- **Dividers within cards:** `border-t border-border` or `border-b border-border`

---

## 9. Components & Patterns

### Buttons (`@/components/ui/button`)

| Variant    | Usage                          | Style                              |
|------------|--------------------------------|------------------------------------|
| `default`  | Primary actions                | Black bg, white text               |
| `outline`  | Secondary actions              | Bordered, transparent              |
| `secondary`| Tertiary actions               | Light grey bg                      |
| `ghost`    | Nav links, subtle actions      | Transparent, hover bg              |
| `destructive`| Delete, dangerous actions   | Red bg                             |
| `link`     | Inline link-styled button      | Underlined text                    |

| Size       | Height | Usage                |
|------------|--------|----------------------|
| `sm`       | 36px   | Nav, compact UI      |
| `default`  | 40px   | Most buttons         |
| `lg`       | 44px   | Forms, section CTAs  |
| `icon`     | 40x40  | Icon-only buttons    |

**CTA buttons** add `rounded-full h-12 px-8 text-base` for a larger pill style.

### Cards

Standard card pattern:
```jsx
<div className="rounded-2xl border border-border bg-card p-6 space-y-4">
  {/* content */}
</div>
```

Large/prominent card:
```jsx
<div className="rounded-2xl border border-border bg-card p-8">
```

### Badges

```jsx
<Badge variant="outline" className="bg-background/50 backdrop-blur-sm">
  Standard badge
</Badge>

<Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
  Sponsored experience
</Badge>
```

**Amber badges** are used for "sponsored" or "sponsored experience" labels. Use `bg-amber-500/10 text-amber-600`.

### Form Fields

Forms use a consistent structure:
```jsx
<div className="space-y-2">
  <Label htmlFor="field">Label</Label>
  <Input id="field" placeholder="..." value={...} onChange={...} />
</div>
```

### Selection Toggles (custom)

For binary choices (like "Would you buy this?"), use the card-button pattern:
```jsx
<button className={cn(
  'rounded-xl border p-4 text-left transition-all flex items-center gap-3',
  selected ? 'border-accent bg-accent/5' : 'border-border hover:border-foreground/30'
)}>
  {/* icon circle + label */}
</button>
```

### Platform Pickers

For choosing from a fixed set of options (like social platforms), use a grid of selectable cards:
```jsx
<button className={cn(
  'flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all',
  selected ? 'border-foreground bg-secondary' : 'border-border hover:border-foreground/30'
)}>
  <Icon className={cn('h-5 w-5', selected ? 'text-foreground' : 'text-muted-foreground')} />
  <span className="text-xs font-medium">{label}</span>
</button>
```

### Status Indicators

- **Pulsing dot:** `<span className="flex h-2 w-2 rounded-full bg-accent animate-pulse-dot" />`
- **Status steps:** Vertical list with icon circles, color-coded by state (done=accent, current=amber, pending=muted)

---

## 10. Animations & Micro-interactions

All custom animations are defined in `app/globals.css`.

### Entrance Animations

| Class               | Effect                          | Duration | Delay classes         |
|---------------------|---------------------------------|----------|-----------------------|
| `animate-fade-up`   | Slide up 20px + fade in         | 0.7s     | `delay-100` through `delay-700` |
| `animate-fade-in`   | Fade in only                    | 0.8s     | same delays           |
| `animate-slide-in-right` | Slide in from right       | 0.5s     | same delays           |

**Usage pattern:** Add `opacity-0-init` alongside the animation class so the element starts invisible, then animates in:
```jsx
<h1 className="animate-fade-up opacity-0-init delay-100">
```

**Stagger entrance animations** using delay classes to create a cascade effect:
```jsx
<div className="animate-fade-up opacity-0-init">          {/* 0ms */}
<h1 className="animate-fade-up delay-100 opacity-0-init"> {/* 100ms */}
<p className="animate-fade-up delay-200 opacity-0-init">  {/* 200ms */}
```

### Continuous Animations

| Class               | Effect                          | Usage                        |
|---------------------|---------------------------------|------------------------------|
| `animate-pulse-dot` | Opacity pulse 1→0.4→1           | Live status dots             |
| `animate-scroll-x`  | Horizontal scroll loop          | Marquee/ticker rows          |

### Hover Micro-interactions

- **Buttons with arrows:** `group` + `group-hover:translate-x-1` on the arrow icon
- **Cards:** `hover:border-foreground/20 hover:shadow-sm` for subtle lift
- **Interactive elements:** `transition-all` or `transition-colors` on everything interactive
- **Star rating:** `transition-transform hover:scale-110` on each star button
- **Logo:** `group-hover:scale-105` on the icon container

### Animation Rules

1. **Use `transition-colors` or `transition-all`** on every interactive element. Default transition duration is 150-300ms (Tailwind default).
2. **Easing:** Entrance animations use `cubic-bezier(0.16, 1, 0.3, 1)` — a smooth deceleration curve.
3. **Never animate layout properties** (width, height) — only transform and opacity for performance.
4. **Stagger delays** in 100ms increments. Don't exceed `delay-700` (700ms) — anything later feels broken.
5. **Respect `prefers-reduced-motion`** — ideally, wrap entrance animations in a media query that disables them. (TODO: not yet implemented, but should be.)

---

## 11. Background Effects

### Grid Background

```jsx
<div className="absolute inset-0 grid-bg opacity-50" />
```

Creates a subtle 64px grid using CSS linear gradients. Used in the hero section. Always paired with a fade-to-background gradient overlay:
```jsx
<div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
```

### Accent Glow

```jsx
<div
  className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 blur-3xl"
  style={{ background: 'radial-gradient(circle, hsl(158 64% 42%), transparent 70%)' }}
/>
```

A blurred radial gradient using the accent color. Creates a soft green glow behind hero content. Use sparingly — one per page maximum.

### Noise Texture

```jsx
<div className="absolute inset-0 noise" />
```

An SVG-based fractal noise overlay. Adds subtle texture to backgrounds. Use at very low opacity.

### Gradient Borders/Glows

```jsx
<div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-blue-500/10 to-accent/10 rounded-3xl blur-2xl" />
```

A blurred gradient behind a card to create a "glowing" effect. Used on the hero mockup.

---

## 12. Navbar Behavior

The navbar is `fixed top-0 inset-x-0 z-50` and changes based on scroll state:

- **Transparent** when at the top of the homepage (`pathname === '/'` and not scrolled)
- **Solid with blur** when scrolled or on any other page: `bg-background/80 backdrop-blur-xl border-b border-border/50`

Use `backdrop-blur-xl` with 80% opacity background — never fully opaque, so content scrolls behind gracefully.

Mobile menu: slide-down panel with `animate-fade-in`, containing stacked links and buttons.

---

## 13. Icons

**Library:** `lucide-react` (already installed, version `^0.446.0`)

**Rules:**
- Always import icons from `lucide-react` at the top of the file.
- Standard icon size: `h-4 w-4` (16px) for inline, `h-5 w-5` (20px) for standalone, `h-8 w-8` (32px) for large/star ratings.
- Color follows context: `text-muted-foreground` for decorative, `text-accent` for highlights, `text-foreground` for active, `text-destructive` for errors.
- For brand/social icons (Instagram, YouTube, Twitter/X, TikTok), use the corresponding lucide icons: `Instagram`, `Youtube`, `Twitter`, `Music2`.

---

## 14. Dark Mode

Dark mode is supported via the `.dark` class on `<html>` (Tailwind `darkMode: ['class']`).

**Rules:**
1. **Never hardcode colors** — always use semantic tokens (`bg-background`, `text-foreground`, etc.) so dark mode works automatically.
2. **Test both modes** — every new component must look correct in both light and dark.
3. **Accent green stays the same** in both modes (`hsl(158 64% 42%)`).
4. **Borders get darker** in dark mode (`0 0% 16%` vs `0 0% 90%`).
5. **Shadows are less visible** in dark mode — rely more on borders and subtle background differences (`bg-card` vs `bg-background`).

---

## 15. Page Structure Template

Every page follows this structure:

```jsx
'use client';  // if using hooks

import { ... } from 'react';
import { ... } from 'next/navigation';
import Link from 'next/link';
import { ... } from 'lucide-react';
import { Button } from '@/components/ui/button';
// ... other UI imports
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export default function PageName() {
  // hooks
  // state
  // effects
  // handlers

  if (loading) {
    return (
      <div className="min-h-screen pt-20 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        {/* back link */}
        {/* header */}
        {/* content */}
      </div>
    </div>
  );
}
```

### Key structural rules:
- **`pt-20`** on the outermost div — clears the fixed navbar.
- **`mx-auto max-w-*`** + **`px-4 sm:px-6 lg:px-8`** — responsive horizontal centering.
- **`py-12`** — standard vertical page padding (more for landing sections).
- **Loading state** — centered spinner text with `animate-pulse`.
- **Back link** — `ArrowLeft` icon + text, `text-muted-foreground hover:text-foreground`, `mb-6`.

---

## 16. Do's and Don'ts

### Do
- Use semantic color tokens (`text-muted-foreground`, `bg-card`, `border-border`)
- Add `transition-colors` or `transition-all` to every interactive element
- Use `rounded-full` for primary CTA buttons
- Use `rounded-2xl` for cards
- Add `text-balance` to headlines
- Stagger entrance animations with delay classes
- Use `backdrop-blur-xl` on overlay backgrounds
- Test at 375px, 768px, 1024px, and 1280px
- Use `space-y-*` for vertical stacking, `gap-*` for grids and flex rows
- Import every icon you use from `lucide-react`

### Don't
- Don't use purple, indigo, or violet as primary colors
- Don't use raw hex or HSL values in component classNames
- Don't use Instrument Serif for body text or UI labels
- Don't use shadows where a border would suffice
- Don't set fixed pixel widths on responsive elements
- Don't forget the `pt-20` page wrapper for navbar clearance
- Don't use more than 3 font weights in a single view
- Don't animate width/height — only transform and opacity
- Don't use `FOR ALL` in RLS policies (unrelated to design but important)
- Don't create new UI component files if a shadcn/ui component already exists

---

## 17. File Organization

| Location                          | Contents                                    |
|-----------------------------------|---------------------------------------------|
| `app/`                            | Pages (App Router)                          |
| `app/globals.css`                 | Global styles, CSS variables, animations    |
| `app/layout.tsx`                  | Root layout, font setup, providers          |
| `components/ui/`                  | shadcn/ui primitives (Button, Input, etc.)  |
| `components/site/`                | Landing page sections (Hero, Navbar, etc.)  |
| `lib/supabase.ts`                 | Supabase client + TypeScript types          |
| `lib/auth-context.tsx`            | Auth provider and hook                      |
| `lib/utils.ts`                    | `cn()` class merge utility                  |
| `hooks/use-toast.ts`              | Toast hook                                  |
| `tailwind.config.ts`              | Tailwind theme config (colors, fonts, etc.) |

---

## 18. Color Cheat Sheet (quick reference)

```
Background:     white / #0A0A0A (dark)
Text primary:   near-black / near-white (dark)
Text muted:     #6B6B6B / #999999 (dark)
Accent:         #27A37A (green-teal, same both modes)
Destructive:    #E63946 / #A52838 (dark)
Border:         #E6E6E6 / #292929 (dark)
Secondary bg:   #F5F5F5 / #1F1F1F (dark)
Amber (stars):  amber-400 fill for ratings
```
