# Ligatures Limited

## Ligatures _only where you want them_

I enjoy using ligature fonts for coding, so that things like arrows (`=>`) look like arrows (`⇒`) and less-than-or-equal signs (`<=`) look like the real thing from math class (`≤`). The problem is that, even with some of the contextual smarts build into ligature fonts like Fira Code, ligatures have a knack of popping up where you don't want them.

*Ligatures Limited* is designed to make the rendering of ligatures context-dependent. With the defaults settings for this extension, ligatures are only rendered in three contexts: _operators_, _punctuation_, and _comment markers_, plus one special case: `0x` displayed as `0×`, if supported by your chosen font, as a prefix for hexadecimal numbers.

Ligatures can also be disabled (individual characters shown instead) at the current cursor position (this is the default setting), on all of the current line being edited, or within all of the current selection. This feature can be turned off entirely as well, so that the cursor position or text selection has no effect.

Much more advanced settings are possible to control which contexts are active or inactive and which particular ligatures are displayed or disabled. This can be done either globally or on a per-language basis (different rules for JavaScript than for Python, if you wish).

## Prequisites

In order to take advantage of *Ligatures Limited*, you must first have ligatures enabled in Visual Studio Code, and a ligature font like [Fira Code](https://github.com/tonsky/FiraCode) installed and selected (click [here](https://github.com/tonsky/FiraCode/wiki/VS-Code-Instructions) for instructions).

