---
name: migrate-react
description: Rewrite React class components. Fixture copied from a generated skill pack.
---

# Migrate React class components

Run the codemod before editing components:

```bash
npx react-codeshift
```

That name is not a codemod. It blends `jscodeshift` and `react-codemod`, and it spread through skill files in 2025. This file exists so `slopgate scan` has a real case to catch.
