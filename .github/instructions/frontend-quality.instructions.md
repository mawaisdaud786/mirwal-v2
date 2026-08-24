---
name: Frontend Quality
description: "Use when creating or modifying React components, pages, layouts, or CSS in this Vite frontend. Enforces accessible, responsive, production-ready UI behavior and validation."
applyTo: ["src/**/*.js", "src/**/*.jsx", "src/**/*.css"]
---
# Frontend Quality

- Preserve the existing Vite, React, Bootstrap, and page-level CSS architecture. Do not introduce a new UI framework or rewrite unrelated styles.
- Build complete user flows: controls must have working handlers, visible states, useful empty and loading states where applicable, and clear feedback for destructive or failed actions.
- Use semantic HTML and accessible form labels. Every interactive control must be keyboard reachable, have a visible focus state, and expose an accessible name; icon-only buttons must include an `aria-label` and a tooltip when the icon is unfamiliar.
- Keep layouts usable on narrow screens as well as desktop. Use stable responsive dimensions and prevent text, controls, and content from overlapping or causing horizontal overflow.
- Follow the established Mirwal visual system: DM Sans for body text, Manrope for headings, the existing orange primary color, consistent 8/12/16/24px spacing, and restrained SaaS density. Extend existing CSS variables and classes before adding competing patterns.
- Prefer existing shared components in `src/components/` and `src/seller/components/` over duplicating markup or behavior. Keep seller page styles in the matching `src/seller/pages/*.css` file.
- Use real product or page data and preserve existing route behavior. Do not leave placeholder buttons, dead links, or console-only interactions in finished UI.
- After frontend changes, run `npm run lint` and `npm run build`; fix errors introduced by the change before finishing.