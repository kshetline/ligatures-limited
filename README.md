# Ligatures Limited

## Ligatures _only where you want them_

I enjoy using ligature fonts for coding so that symbols like arrows (`=>`) look like arrows (`⇒`) and less-than-or-equal signs (`<=`) look like the real thing from math class (`≤`). The problem is that, even with some of the contextual smarts build into ligature fonts like Fira Code, ligatures have a knack of popping up where you don't want them.

<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/without_suppressed_ligatures.jpg" width="407" height="67" alt="Without ligature suppression">
<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/with_suppressed_ligatures.jpg" width="407" height="67" alt="With ligature suppression">

*Ligatures Limited* is designed to make the rendering of ligatures context-dependent.

In the top image, you can see ligatures that don't make sense where they are — in the regex, where three different characters are being checked (not one big two-headed arrow), and the oddly formatted asterisks in the message string.

The image below shows how those out-of-place ligatures are suppressed by *Ligatures Limited*, replaced with individual characters, while the triple-equals and double-ampersand ligatures are retained.

With the defaults settings for this extension, ligatures are only rendered in three contexts: _operators_, _punctuation_, and _comment markers_, plus one special case: `0x` when followed by a hexadecimal digit in a numeric context, rendered as `0×` (if supported by your chosen font).

Also by default, ligatures for `www`, `ff`, `fi`, `fl`, `ffi`, `ffl` are suppressed in all contexts, as well as the special case of `x` between any two decimal digits, which unless suppressed renders as (for example) `2×4`. If you want to see these ligatures (provided, of courses, that your chosen font contains them), you must expressly enable them.

Ligatures can also be suppressed (individual characters shown instead) at the current cursor position (this is the default setting), on all of the current line being edited, or within all of the current selection. This feature can be turned off entirely as well, so that the cursor position or text selection has no effect.

While the default settings should meet many people's needs, custom settings are available to control some of the features of *Ligatures Limited*, to control which syntactical contexts are handled, and which particular ligatures are displayed or suppressed. Settings can be global or on a per-language basis (different rules for JavaScript than for Python, if you wish).

## Prerequisites

In order to take advantage of *Ligatures Limited*, you must first have ligatures enabled in Visual Studio Code, and a ligature font like [Fira Code](https://github.com/tonsky/FiraCode) installed and selected (click [here](https://github.com/tonsky/FiraCode/wiki/VS-Code-Instructions) for instructions).

## Ligatures handled by *Ligatures Limited*

<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/ligature_set.jpg" width="763" height="100" alt="Supported ligatures">
<br>
<img src="https://shetline.com/readme/ligatures-limited/v1.0.0/ligature_set_suppressed.jpg" width="763" height="100" alt="Supported ligatures as individual characters">

## Custom settings

```text
attribute_name  comment         comment_marker  constant        function
identifier      invalid         keyword         number          operator
other           property_name   property_value  punctuation     regexp
scope           string          tag             text            type
variable
```

## Credits

This project is a spin-off of two other projects, [vscode-Disable-Ligatures](https://github.com/CoenraadS/vscode-Disable-Ligatures) by CoenraadS, and [scope-info](https://github.com/siegebell/scope-info), by C. J. Bell.
